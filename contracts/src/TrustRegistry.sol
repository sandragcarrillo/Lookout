// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

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
 *        Verified onchain via Self Agent Registry before setting isHumanBacked.
 *     3. Human-readable "recibos" — audit reports stored on IPFS
 *     4. Composable API — other agents/dApps query scores before transacting
 *
 *   Score range: 0-100
 *     0-25  → Not trusted
 *     26-50 → Caution
 *     51-75 → Trusted
 *     76-100 → Highly trusted
 *
 *   Security model:
 *     - Only the agent itself can register (msg.sender == agent)
 *     - Scores can only be written by the designated auditor wallet
 *     - isHumanBacked=true requires onchain ZK proof confirmation via Self Protocol
 *     - Score updates are rate-limited to once per MIN_AUDIT_INTERVAL
 *     - Ownership transfer is two-step (propose → accept) to prevent misaddress
 */

// -----------------------------------------------------------------------
// External interfaces
// -----------------------------------------------------------------------

/// @notice Minimal interface to read ERC-8004 IdentityRegistry
interface IERC8004Identity {
    function ownerOf(uint256 tokenId) external view returns (address);
}

/// @notice Self Protocol Agent Registry — ZK human-backed identity for AI agents.
/// @dev Deployed at:
///   Celo mainnet  (42220):     0xaC3DF9ABf80d0F5c020C06B04Cced27763355944
///   Celo Sepolia  (11142220):  0x043DaCac8b0771DD5b444bCC88f2f8BBDBEdd379
///   Pass address(0) at deployment on chains where Self is not yet available.
interface ISelfAgentRegistry {
    /// @notice Returns true if the agent at `agentKey` is registered and has an
    ///         active, unexpired ZK human proof.
    /// @param agentKey bytes32(uint256(uint160(agentAddress)))
    function isVerifiedAgent(bytes32 agentKey) external view returns (bool);
}

// -----------------------------------------------------------------------
// TrustRegistry
// -----------------------------------------------------------------------

contract TrustRegistry {

    // -------------------------------------------------------------------
    // Types
    // -------------------------------------------------------------------

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
        uint256 erc8004Id;       // ERC-8004 tokenId (0 if not registered there)
        uint256 score;           // 0-100
        ScoreBreakdown breakdown;
        bool    isHumanBacked;   // Self Protocol ZK-verified human behind agent
        bool    isActive;        // false = deactivated by owner
        uint256 firstSeenAt;
        uint256 lastAuditedAt;
        uint256 auditCount;
        string  latestReportCID; // IPFS CID of the most recent "recibo"
    }

    // -------------------------------------------------------------------
    // Constants
    // -------------------------------------------------------------------

    /// @notice ERC-8004 IdentityRegistry — same address on all supported chains
    address public constant ERC8004_REGISTRY = 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432;

    /// @notice Minimum time between score updates for a given agent.
    ///         Prevents flash manipulation (score 100 → 0 → 100 in one block).
    uint256 public constant MIN_AUDIT_INTERVAL = 1 hours;

    // -------------------------------------------------------------------
    // State
    // -------------------------------------------------------------------

    address public owner;

    /// @notice Pending owner for two-step transfer. Zero when no transfer is in progress.
    address public pendingOwner;

    /// @notice Lookout agent wallet that writes scores. Rotatable by owner.
    address public auditor;

    /// @notice Self Protocol Agent Registry for onchain ZK human verification.
    ///         Immutable — set once at deployment. address(0) disables the check.
    address public immutable SELF_AGENT_REGISTRY;

    mapping(address => AgentProfile) private profiles;

    /// @dev Private — use getAgentsPaginated(). Exposed length via totalAgents().
    address[] private agentList;

    uint256 public totalAudits;

    // -------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------

    event AgentRegistered(
        address indexed agent,
        uint256 erc8004Id,
        uint256 timestamp
    );
    event AgentDeactivated(
        address indexed agent,
        uint256 timestamp
    );
    event ScoreUpdated(
        address indexed agent,
        uint256 oldScore,
        uint256 newScore,
        string  reportCID,
        uint256 timestamp
    );
    event HumanVerificationUpdated(
        address indexed agent,
        bool    verified,
        uint256 timestamp
    );
    event AuditorChanged(
        address indexed oldAuditor,
        address indexed newAuditor
    );
    event OwnershipTransferProposed(
        address indexed currentOwner,
        address indexed proposed
    );
    event OwnershipTransferred(
        address indexed oldOwner,
        address indexed newOwner
    );

    // -------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------

    error NotOwner();
    error NotAuditor();
    error NotPendingOwner();
    error AlreadyRegistered();
    error NotRegistered();
    error ScoreOutOfRange();
    error ZeroAddress();
    error NotERC8004Owner();
    error NotSelfVerified();
    error InvalidBreakdown();
    error AuditTooFrequent();

    // -------------------------------------------------------------------
    // Modifiers
    // -------------------------------------------------------------------

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyAuditor() {
        if (msg.sender != auditor) revert NotAuditor();
        _;
    }

    // -------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------

    /// @param _auditor           The Lookout agent wallet that will write scores.
    /// @param _selfAgentRegistry Self Protocol Agent Registry address.
    ///                           Pass address(0) on chains where Self is not deployed.
    constructor(address _auditor, address _selfAgentRegistry) {
        if (_auditor == address(0)) revert ZeroAddress();
        owner = msg.sender;
        auditor = _auditor;
        SELF_AGENT_REGISTRY = _selfAgentRegistry;
    }

    // -------------------------------------------------------------------
    // Registration
    // -------------------------------------------------------------------

    /// @notice Register yourself to start building reputation.
    /// @dev    Only the agent itself can register — msg.sender becomes the agent address.
    ///         This prevents griefing (no third party can lock your address).
    /// @param _erc8004Id ERC-8004 tokenId if registered there (0 if not).
    ///                   The token must be owned by msg.sender.
    function registerAgent(uint256 _erc8004Id) external {
        address _agent = msg.sender;
        if (profiles[_agent].isActive) revert AlreadyRegistered();

        // --- Effects (state changes before external calls — CEI pattern) ---
        profiles[_agent] = AgentProfile({
            agentAddress:    _agent,
            erc8004Id:       _erc8004Id,
            score:           0,
            breakdown:       ScoreBreakdown(0, 0, 0, 0, 0, 0, 0, 0),
            isHumanBacked:   false,
            isActive:        true,
            firstSeenAt:     block.timestamp,
            lastAuditedAt:   0,
            auditCount:      0,
            latestReportCID: ""
        });
        agentList.push(_agent);
        emit AgentRegistered(_agent, _erc8004Id, block.timestamp);

        // --- Interaction (external call last — CEI pattern) ---
        // If ERC-8004 ID provided, verify the caller owns that token.
        // ownerOf reverts if the tokenId doesn't exist.
        if (_erc8004Id > 0) {
            address tokenOwner = IERC8004Identity(ERC8004_REGISTRY).ownerOf(_erc8004Id);
            if (tokenOwner != _agent) revert NotERC8004Owner();
        }
    }

    // -------------------------------------------------------------------
    // Scoring (only auditor)
    // -------------------------------------------------------------------

    /// @notice Write a new TrustScore after auditing an agent's on-chain behavior.
    /// @dev    Rate-limited to MIN_AUDIT_INTERVAL per agent after the first audit.
    ///         ScoreBreakdown fields are validated against protocol spec ranges.
    function updateScore(
        address              _agent,
        uint256              _score,
        ScoreBreakdown calldata _breakdown,
        string  calldata     _reportCID
    ) external onlyAuditor {
        AgentProfile storage p = profiles[_agent];
        if (!p.isActive)  revert NotRegistered();
        if (_score > 100) revert ScoreOutOfRange();

        // Rate-limit: skip check on first audit (lastAuditedAt == 0)
        if (p.lastAuditedAt > 0 && block.timestamp < p.lastAuditedAt + MIN_AUDIT_INTERVAL) {
            revert AuditTooFrequent();
        }

        _validateBreakdown(_breakdown);

        uint256 oldScore = p.score;
        p.score           = _score;
        p.breakdown       = _breakdown;
        p.lastAuditedAt   = block.timestamp;
        p.latestReportCID = _reportCID;
        p.auditCount++;
        totalAudits++;

        emit ScoreUpdated(_agent, oldScore, _score, _reportCID, block.timestamp);
    }

    /// @notice Mark agent as human-verified via Self Protocol ZK proof.
    /// @dev    When setting _verified=true and SELF_AGENT_REGISTRY is configured,
    ///         this function makes a live onchain call to the Self Agent Registry to
    ///         confirm the ZK proof is present and valid before writing the flag.
    ///         The auditor CANNOT arbitrarily set isHumanBacked=true if Self Protocol
    ///         has not verified the agent.
    ///         When setting _verified=false (revocation), no Self check is needed.
    function setHumanVerified(address _agent, bool _verified) external onlyAuditor {
        AgentProfile storage p = profiles[_agent];
        if (!p.isActive) revert NotRegistered();

        if (_verified && SELF_AGENT_REGISTRY != address(0)) {
            bytes32 agentKey = bytes32(uint256(uint160(_agent)));
            if (!ISelfAgentRegistry(SELF_AGENT_REGISTRY).isVerifiedAgent(agentKey)) {
                revert NotSelfVerified();
            }
        }

        p.isHumanBacked = _verified;
        emit HumanVerificationUpdated(_agent, _verified, block.timestamp);
    }

    // -------------------------------------------------------------------
    // Read functions — FREE (what other agents & dApps call)
    // -------------------------------------------------------------------

    /// @notice Quick score check before transacting with an agent.
    /// @dev    Returns 0 for unregistered agents. Call isRegistered() to distinguish
    ///         "never registered" (returns 0) from "registered but scored at 0".
    function getScore(address _agent) external view returns (uint256) {
        return profiles[_agent].score;
    }

    /// @notice Full profile with breakdown, verification status, and report CID.
    function getFullProfile(address _agent)
        external view returns (AgentProfile memory)
    {
        return profiles[_agent];
    }

    /// @notice Is there a ZK-verified human behind this agent?
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
    ///         Returns 0 for unregistered addresses; check isRegistered() per entry.
    function getScores(address[] calldata _agents)
        external view returns (uint256[] memory)
    {
        uint256[] memory scores = new uint256[](_agents.length);
        for (uint256 i = 0; i < _agents.length; i++) {
            scores[i] = profiles[_agents[i]].score;
        }
        return scores;
    }

    /// @notice Total number of registered agents.
    function totalAgents() external view returns (uint256) {
        return agentList.length;
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

    // -------------------------------------------------------------------
    // Admin
    // -------------------------------------------------------------------

    /// @notice Deactivate a compromised or fraudulently registered agent.
    ///         Deactivated agents retain their score history in events but
    ///         isRegistered() returns false and updateScore() reverts.
    function deactivateAgent(address _agent) external onlyOwner {
        if (!profiles[_agent].isActive) revert NotRegistered();
        profiles[_agent].isActive = false;
        emit AgentDeactivated(_agent, block.timestamp);
    }

    /// @notice Rotate auditor wallet.
    function setAuditor(address _newAuditor) external onlyOwner {
        if (_newAuditor == address(0)) revert ZeroAddress();
        address old = auditor;
        auditor = _newAuditor;
        emit AuditorChanged(old, _newAuditor);
    }

    /// @notice Propose ownership transfer. New owner must call acceptOwnership().
    ///         Two-step prevents permanent lockout from a mistyped address.
    function transferOwnership(address _newOwner) external onlyOwner {
        if (_newOwner == address(0)) revert ZeroAddress();
        pendingOwner = _newOwner;
        emit OwnershipTransferProposed(owner, _newOwner);
    }

    /// @notice Accept a pending ownership transfer.
    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        address old = owner;
        owner = pendingOwner;
        pendingOwner = address(0);
        emit OwnershipTransferred(old, owner);
    }

    // -------------------------------------------------------------------
    // Internal helpers
    // -------------------------------------------------------------------

    /// @dev Validates ScoreBreakdown fields against protocol spec ranges.
    ///      Prevents the auditor from storing inconsistent or out-of-range data.
    function _validateBreakdown(ScoreBreakdown calldata b) internal pure {
        if (b.txCount > 15)                               revert InvalidBreakdown();
        if (b.successRate > 15)                           revert InvalidBreakdown();
        if (b.accountAge > 15)                            revert InvalidBreakdown();
        if (b.counterparties > 15)                        revert InvalidBreakdown();
        if (b.selfBonus != 0 && b.selfBonus != 15)        revert InvalidBreakdown();
        if (b.ensBonus != 0 && b.ensBonus != 5)           revert InvalidBreakdown();
        if (b.consistencyBonus != 0 && b.consistencyBonus != 10) revert InvalidBreakdown();
        if (b.penalties < -30 || b.penalties > 0)         revert InvalidBreakdown();
    }
}
