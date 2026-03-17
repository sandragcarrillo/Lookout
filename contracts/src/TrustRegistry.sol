// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title TrustRegistry
 * @author Lookout — Agent Trust Protocol
 * @notice On-chain reputation scoring for AI agents, built on top of ERC-8004.
 * @dev
 *   Lookout does NOT reinvent agent identity. ERC-8004 IdentityRegistry
 *   (0x8004A169FB4a3325136EB29fA0ceB6D2e539a432) already handles that.
 *
 *   What Lookout adds:
 *     1. Behavioral scoring — audits on-chain txs and calculates TrustScore
 *     2. Self Protocol verification — ZK proof that a human backs the agent
 *     3. Human-readable "recibos" — audit reports stored on IPFS
 *     4. Composable API — other agents/dApps query scores before transacting
 *
 *   Score range: 0-100
 *     0-25  → 🔴 Not trusted
 *     26-50 → 🟡 Caution
 *     51-75 → 🟢 Trusted
 *     76-100 → 💎 Highly trusted
 *
 */

/// @notice Minimal interface to read ERC-8004 IdentityRegistry
interface IERC8004Identity {
    function ownerOf(uint256 tokenId) external view returns (address);
    function tokenURI(uint256 tokenId) external view returns (string memory);
}

contract TrustRegistry {

    // ---------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------

    struct ScoreBreakdown {
        uint8 txCount;          // 0-15  — more txs = more data = more reliable
        uint8 successRate;      // 0-15  — % of txs that didn't revert
        uint8 accountAge;       // 0-15  — days since first tx
        uint8 counterparties;   // 0-15  — diversity of addresses interacted with
        uint8 selfBonus;        // 0 or 15 — human verified via Self Protocol
        uint8 ensBonus;         // 0 or 5  — has ENS name
        uint8 consistencyBonus; // 0 or 10 — operates regularly, no suspicious bursts
        int8  penalties;        // -30 to 0
    }

    struct AgentProfile {
        address agentAddress;
        uint256 erc8004Id;      // ERC-8004 tokenId (0 if not registered there)
        uint256 score;          // 0-100
        ScoreBreakdown breakdown;
        bool    isHumanBacked;  // Self Protocol verified
        bool    isActive;
        uint256 firstSeenAt;
        uint256 lastAuditedAt;
        uint256 auditCount;
        string  latestReportCID; // IPFS CID of the most recent "recibo"
    }

    // ---------------------------------------------------------------
    // State
    // ---------------------------------------------------------------

    address public owner;
    address public auditor;  // Lookout agent wallet that writes scores

    /// @notice ERC-8004 IdentityRegistry — same address on all chains
    address public constant ERC8004_REGISTRY = 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432;

    mapping(address => AgentProfile) private profiles;
    address[] public agentList;

    uint256 public totalAgents;
    uint256 public totalAudits;

    // ---------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------

    event AgentRegistered(
        address indexed agent,
        uint256 erc8004Id,
        uint256 timestamp
    );
    event ScoreUpdated(
        address indexed agent,
        uint256 oldScore,
        uint256 newScore,
        string reportCID,
        uint256 timestamp
    );
    event HumanVerificationUpdated(
        address indexed agent,
        bool verified,
        uint256 timestamp
    );
    event AuditorChanged(
        address indexed oldAuditor,
        address indexed newAuditor
    );

    // ---------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------

    error NotOwner();
    error NotAuditor();
    error AlreadyRegistered();
    error NotRegistered();
    error ScoreOutOfRange();
    error ZeroAddress();

    // ---------------------------------------------------------------
    // Modifiers
    // ---------------------------------------------------------------

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyAuditor() {
        if (msg.sender != auditor) revert NotAuditor();
        _;
    }

    // ---------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------

    /// @param _auditor The Lookout agent wallet that will write scores.
    constructor(address _auditor) {
        if (_auditor == address(0)) revert ZeroAddress();
        owner = msg.sender;
        auditor = _auditor;
    }

    // ---------------------------------------------------------------
    // Registration
    // ---------------------------------------------------------------

    /// @notice Register an agent to start building reputation.
    /// @param _agent  Wallet address of the agent.
    /// @param _erc8004Id  ERC-8004 tokenId if the agent is registered there (0 if not).
    function registerAgent(address _agent, uint256 _erc8004Id) external {
        if (_agent == address(0)) revert ZeroAddress();
        if (profiles[_agent].isActive) revert AlreadyRegistered();

        // If ERC-8004 ID provided, verify ownership
        if (_erc8004Id > 0) {
            IERC8004Identity registry = IERC8004Identity(ERC8004_REGISTRY);
            // ownerOf will revert if tokenId doesn't exist
            require(
                registry.ownerOf(_erc8004Id) == msg.sender || 
                registry.ownerOf(_erc8004Id) == _agent,
                "Not ERC-8004 owner"
            );
        }

        profiles[_agent] = AgentProfile({
            agentAddress: _agent,
            erc8004Id: _erc8004Id,
            score: 0,
            breakdown: ScoreBreakdown(0, 0, 0, 0, 0, 0, 0, 0),
            isHumanBacked: false,
            isActive: true,
            firstSeenAt: block.timestamp,
            lastAuditedAt: 0,
            auditCount: 0,
            latestReportCID: ""
        });

        agentList.push(_agent);
        totalAgents++;

        emit AgentRegistered(_agent, _erc8004Id, block.timestamp);
    }

    // ---------------------------------------------------------------
    // Scoring (only auditor)
    // ---------------------------------------------------------------

    /// @notice Write a new TrustScore after auditing an agent's on-chain behavior.
    function updateScore(
        address _agent,
        uint256 _score,
        ScoreBreakdown calldata _breakdown,
        string calldata _reportCID
    ) external onlyAuditor {
        AgentProfile storage p = profiles[_agent];
        if (!p.isActive) revert NotRegistered();
        if (_score > 100) revert ScoreOutOfRange();

        uint256 oldScore = p.score;
        p.score = _score;
        p.breakdown = _breakdown;
        p.lastAuditedAt = block.timestamp;
        p.latestReportCID = _reportCID;
        p.auditCount++;

        totalAudits++;

        emit ScoreUpdated(_agent, oldScore, _score, _reportCID, block.timestamp);
    }

    /// @notice Mark agent as human-verified via Self Protocol ZK proof.
    function setHumanVerified(
        address _agent,
        bool _verified
    ) external onlyAuditor {
        AgentProfile storage p = profiles[_agent];
        if (!p.isActive) revert NotRegistered();

        p.isHumanBacked = _verified;

        emit HumanVerificationUpdated(_agent, _verified, block.timestamp);
    }

    // ---------------------------------------------------------------
    // Read functions — FREE (what other agents & dApps call)
    // ---------------------------------------------------------------

    /// @notice Quick score check before transacting with an agent.
    function getScore(address _agent) external view returns (uint256) {
        return profiles[_agent].score;
    }

    /// @notice Full profile with breakdown, verification status, and report CID.
    function getFullProfile(address _agent) 
        external view returns (AgentProfile memory) 
    {
        return profiles[_agent];
    }

    /// @notice Is there a verified human behind this agent?
    function isHumanBacked(address _agent) external view returns (bool) {
        return profiles[_agent].isHumanBacked;
    }

    /// @notice Is this agent registered in Lookout?
    function isRegistered(address _agent) external view returns (bool) {
        return profiles[_agent].isActive;
    }

    /// @notice Get trust level as string — useful for skill.md consumers.
    function getTrustLevel(address _agent) 
        external view returns (string memory) 
    {
        uint256 s = profiles[_agent].score;
        if (s >= 76) return "highly_trusted";
        if (s >= 51) return "trusted";
        if (s >= 26) return "caution";
        return "not_trusted";
    }

    /// @notice Get the IPFS CID of the latest audit report ("recibo").
    function getReportCID(address _agent) 
        external view returns (string memory) 
    {
        return profiles[_agent].latestReportCID;
    }

    /// @notice Batch score check — for agents evaluating multiple counterparties.
    function getScores(address[] calldata _agents) 
        external view returns (uint256[] memory) 
    {
        uint256[] memory scores = new uint256[](_agents.length);
        for (uint256 i = 0; i < _agents.length; i++) {
            scores[i] = profiles[_agents[i]].score;
        }
        return scores;
    }

    /// @notice Get all registered agent addresses.
    function getAllAgents() external view returns (address[] memory) {
        return agentList;
    }

    /// @notice Paginated agent list for indexing.
    function getAgentsPaginated(uint256 _offset, uint256 _limit)
        external view returns (address[] memory)
    {
        if (_offset >= agentList.length) return new address[](0);
        uint256 end = _offset + _limit;
        if (end > agentList.length) end = agentList.length;

        address[] memory result = new address[](end - _offset);
        for (uint256 i = _offset; i < end; i++) {
            result[i - _offset] = agentList[i];
        }
        return result;
    }

    // ---------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------

    /// @notice Rotate auditor wallet.
    function setAuditor(address _newAuditor) external onlyOwner {
        if (_newAuditor == address(0)) revert ZeroAddress();
        address old = auditor;
        auditor = _newAuditor;
        emit AuditorChanged(old, _newAuditor);
    }

    /// @notice Transfer ownership.
    function transferOwnership(address _newOwner) external onlyOwner {
        if (_newOwner == address(0)) revert ZeroAddress();
        owner = _newOwner;
    }
}
