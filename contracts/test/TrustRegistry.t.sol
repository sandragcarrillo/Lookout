// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "forge-std/Test.sol";
import "../src/TrustRegistry.sol";

// -----------------------------------------------------------------------
// Mock contracts
// -----------------------------------------------------------------------

/// @dev Minimal ERC-8004 mock — ownerOf returns whatever we configure.
contract MockERC8004 {
    mapping(uint256 => address) private _owners;

    function setOwner(uint256 tokenId, address owner) external {
        _owners[tokenId] = owner;
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        address o = _owners[tokenId];
        require(o != address(0), "ERC721: invalid token ID");
        return o;
    }
}

/// @dev Mock Self Agent Registry — isVerifiedAgent returns whatever we configure.
contract MockSelfAgentRegistry {
    mapping(bytes32 => bool) private _verified;

    function setVerified(address agent, bool value) external {
        _verified[bytes32(uint256(uint160(agent)))] = value;
    }

    function isVerifiedAgent(bytes32 agentKey) external view returns (bool) {
        return _verified[agentKey];
    }
}

// -----------------------------------------------------------------------
// Test contract
// -----------------------------------------------------------------------

contract TrustRegistryTest is Test {

    // Mirror events for vm.expectEmit
    event AgentRegistered(address indexed agent, uint256 erc8004Id, uint256 timestamp);
    event AgentDeactivated(address indexed agent, uint256 timestamp);
    event ScoreUpdated(address indexed agent, uint256 oldScore, uint256 newScore, string reportCID, uint256 timestamp);
    event HumanVerificationUpdated(address indexed agent, bool verified, uint256 timestamp);
    event OwnershipTransferProposed(address indexed currentOwner, address indexed proposed);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    event AuditorChanged(address indexed oldAuditor, address indexed newAuditor);

    TrustRegistry         public registry;
    MockERC8004           public erc8004;
    MockSelfAgentRegistry public selfRegistry;

    address owner   = address(this);
    address auditor = makeAddr("auditor");
    address agent1  = makeAddr("agent1");
    address agent2  = makeAddr("agent2");
    address nobody  = makeAddr("nobody");

    function setUp() public {
        erc8004      = new MockERC8004();
        selfRegistry = new MockSelfAgentRegistry();
        registry     = new TrustRegistry(auditor, address(selfRegistry));
    }

    // Helpers
    function _register(address agent) internal {
        vm.prank(agent);
        registry.registerAgent(0);
    }

    function _emptyBreakdown() internal pure returns (TrustRegistry.ScoreBreakdown memory) {
        return TrustRegistry.ScoreBreakdown(0, 0, 0, 0, 0, 0, 0, 0);
    }

    function _validBreakdown() internal pure returns (TrustRegistry.ScoreBreakdown memory) {
        return TrustRegistry.ScoreBreakdown({
            txCount:        12,
            successRate:    14,
            accountAge:     10,
            counterparties: 8,
            selfBonus:      0,
            ensBonus:       0,
            consistencyBonus: 0,
            penalties:      -2
        });
    }

    // -----------------------------------------------------------------------
    // Constructor
    // -----------------------------------------------------------------------

    function test_constructor_setsState() public view {
        assertEq(registry.owner(),               owner);
        assertEq(registry.auditor(),             auditor);
        assertEq(registry.SELF_AGENT_REGISTRY(), address(selfRegistry));
    }

    function test_constructor_revertsOnZeroAuditor() public {
        vm.expectRevert(TrustRegistry.ZeroAddress.selector);
        new TrustRegistry(address(0), address(selfRegistry));
    }

    function test_constructor_allowsZeroSelfRegistry() public {
        TrustRegistry r = new TrustRegistry(auditor, address(0));
        assertEq(r.SELF_AGENT_REGISTRY(), address(0));
    }

    // -----------------------------------------------------------------------
    // Registration — only msg.sender can register
    // -----------------------------------------------------------------------

    function test_registerAgent_basic() public {
        _register(agent1);
        assertTrue(registry.isRegistered(agent1));
        assertEq(registry.totalAgents(), 1);
    }

    function test_registerAgent_emitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit AgentRegistered(agent1, 0, block.timestamp);
        vm.prank(agent1);
        registry.registerAgent(0);
    }

    function test_registerAgent_revertsIfAlreadyRegistered() public {
        _register(agent1);
        vm.expectRevert(TrustRegistry.AlreadyRegistered.selector);
        vm.prank(agent1);
        registry.registerAgent(0);
    }

    function test_registerAgent_multipleAgents() public {
        _register(agent1);
        _register(agent2);
        assertEq(registry.totalAgents(), 2);
    }

    // H-2 fix: third party cannot register on behalf of another address
    function test_registerAgent_onlyCallerCanRegister() public {
        // nobody cannot register agent1 — they can only register themselves
        vm.prank(nobody);
        registry.registerAgent(0); // registers nobody, not agent1
        assertTrue(registry.isRegistered(nobody));
        assertFalse(registry.isRegistered(agent1));
    }

    // H-3 fix: ERC-8004 token must be owned by the caller (agent)
    function test_registerAgent_withValidERC8004() public {
        uint256 tokenId = 42;
        erc8004.setOwner(tokenId, agent1);

        // Override the constant via vm.mockCall
        bytes memory callData = abi.encodeWithSignature("ownerOf(uint256)", tokenId);
        vm.mockCall(
            registry.ERC8004_REGISTRY(),
            callData,
            abi.encode(agent1)
        );

        vm.prank(agent1);
        registry.registerAgent(tokenId);
        assertTrue(registry.isRegistered(agent1));
    }

    function test_registerAgent_revertsIfERC8004NotOwned() public {
        uint256 tokenId = 42;

        // Token owned by someone else
        vm.mockCall(
            registry.ERC8004_REGISTRY(),
            abi.encodeWithSignature("ownerOf(uint256)", tokenId),
            abi.encode(nobody)
        );

        vm.expectRevert(TrustRegistry.NotERC8004Owner.selector);
        vm.prank(agent1);
        registry.registerAgent(tokenId);
    }

    // -----------------------------------------------------------------------
    // Scoring
    // -----------------------------------------------------------------------

    function test_updateScore_works() public {
        _register(agent1);

        TrustRegistry.ScoreBreakdown memory b = _validBreakdown();

        vm.prank(auditor);
        registry.updateScore(agent1, 42, b, "QmTestCID");

        assertEq(registry.getScore(agent1), 42);

        TrustRegistry.AgentProfile memory p = registry.getFullProfile(agent1);
        assertEq(p.breakdown.txCount,    12);
        assertEq(p.breakdown.penalties, -2);
        assertEq(p.auditCount,           1);
        assertEq(keccak256(bytes(p.latestReportCID)), keccak256(bytes("QmTestCID")));
    }

    function test_updateScore_emitsWithOldAndNew() public {
        _register(agent1);
        TrustRegistry.ScoreBreakdown memory b = _emptyBreakdown();

        vm.prank(auditor);
        registry.updateScore(agent1, 30, b, "QmFirst");

        vm.warp(block.timestamp + 1 hours + 1);

        vm.expectEmit(true, false, false, true);
        emit ScoreUpdated(agent1, 30, 75, "QmSecond", block.timestamp);

        vm.prank(auditor);
        registry.updateScore(agent1, 75, b, "QmSecond");
    }

    function test_updateScore_incrementsAuditCount() public {
        _register(agent1);
        TrustRegistry.ScoreBreakdown memory b = _emptyBreakdown();

        vm.startPrank(auditor);
        registry.updateScore(agent1, 30, b, "");
        vm.warp(block.timestamp + 1 hours + 1);
        registry.updateScore(agent1, 50, b, "");
        vm.warp(block.timestamp + 1 hours + 1);
        registry.updateScore(agent1, 70, b, "");
        vm.stopPrank();

        TrustRegistry.AgentProfile memory p = registry.getFullProfile(agent1);
        assertEq(p.auditCount,       3);
        assertEq(registry.totalAudits(), 3);
    }

    function test_updateScore_revertsIfNotAuditor() public {
        _register(agent1);
        TrustRegistry.ScoreBreakdown memory b = _emptyBreakdown();

        vm.prank(nobody);
        vm.expectRevert(TrustRegistry.NotAuditor.selector);
        registry.updateScore(agent1, 50, b, "");
    }

    function test_updateScore_revertsIfNotRegistered() public {
        TrustRegistry.ScoreBreakdown memory b = _emptyBreakdown();

        vm.prank(auditor);
        vm.expectRevert(TrustRegistry.NotRegistered.selector);
        registry.updateScore(agent1, 50, b, "");
    }

    function test_updateScore_revertsIfScoreOver100() public {
        _register(agent1);
        TrustRegistry.ScoreBreakdown memory b = _emptyBreakdown();

        vm.prank(auditor);
        vm.expectRevert(TrustRegistry.ScoreOutOfRange.selector);
        registry.updateScore(agent1, 101, b, "");
    }

    // M-5 fix: rate limit
    function test_updateScore_revertsIfTooFrequent() public {
        _register(agent1);
        TrustRegistry.ScoreBreakdown memory b = _emptyBreakdown();

        vm.startPrank(auditor);
        registry.updateScore(agent1, 30, b, "");

        // Immediate second update — should revert
        vm.expectRevert(TrustRegistry.AuditTooFrequent.selector);
        registry.updateScore(agent1, 50, b, "");
        vm.stopPrank();
    }

    function test_updateScore_allowsUpdateAfterInterval() public {
        _register(agent1);
        TrustRegistry.ScoreBreakdown memory b = _emptyBreakdown();

        vm.prank(auditor);
        registry.updateScore(agent1, 30, b, "");

        vm.warp(block.timestamp + 1 hours + 1);

        vm.prank(auditor);
        registry.updateScore(agent1, 70, b, "");

        assertEq(registry.getScore(agent1), 70);
    }

    function test_updateScore_firstAuditBypassesInterval() public {
        _register(agent1);
        TrustRegistry.ScoreBreakdown memory b = _emptyBreakdown();

        // First audit: no interval check
        vm.prank(auditor);
        registry.updateScore(agent1, 50, b, "");
        assertEq(registry.getScore(agent1), 50);
    }

    // M-2 fix: breakdown validation
    function test_updateScore_revertsOnInvalidTxCount() public {
        _register(agent1);
        TrustRegistry.ScoreBreakdown memory b = _emptyBreakdown();
        b.txCount = 16; // > 15

        vm.prank(auditor);
        vm.expectRevert(TrustRegistry.InvalidBreakdown.selector);
        registry.updateScore(agent1, 50, b, "");
    }

    function test_updateScore_revertsOnInvalidSelfBonus() public {
        _register(agent1);
        TrustRegistry.ScoreBreakdown memory b = _emptyBreakdown();
        b.selfBonus = 7; // not 0 or 15

        vm.prank(auditor);
        vm.expectRevert(TrustRegistry.InvalidBreakdown.selector);
        registry.updateScore(agent1, 50, b, "");
    }

    function test_updateScore_revertsOnInvalidEnsBonus() public {
        _register(agent1);
        TrustRegistry.ScoreBreakdown memory b = _emptyBreakdown();
        b.ensBonus = 3; // not 0 or 5

        vm.prank(auditor);
        vm.expectRevert(TrustRegistry.InvalidBreakdown.selector);
        registry.updateScore(agent1, 50, b, "");
    }

    function test_updateScore_revertsOnInvalidConsistencyBonus() public {
        _register(agent1);
        TrustRegistry.ScoreBreakdown memory b = _emptyBreakdown();
        b.consistencyBonus = 9; // not 0 or 10

        vm.prank(auditor);
        vm.expectRevert(TrustRegistry.InvalidBreakdown.selector);
        registry.updateScore(agent1, 50, b, "");
    }

    function test_updateScore_revertsOnPenaltiesOutOfRange() public {
        _register(agent1);
        TrustRegistry.ScoreBreakdown memory b = _emptyBreakdown();
        b.penalties = -31; // below -30

        vm.prank(auditor);
        vm.expectRevert(TrustRegistry.InvalidBreakdown.selector);
        registry.updateScore(agent1, 50, b, "");
    }

    function test_updateScore_revertsOnPositivePenalties() public {
        _register(agent1);
        TrustRegistry.ScoreBreakdown memory b = _emptyBreakdown();
        b.penalties = 1; // positive not allowed

        vm.prank(auditor);
        vm.expectRevert(TrustRegistry.InvalidBreakdown.selector);
        registry.updateScore(agent1, 50, b, "");
    }

    function test_updateScore_acceptsMaxValidBreakdown() public {
        _register(agent1);
        TrustRegistry.ScoreBreakdown memory b = TrustRegistry.ScoreBreakdown({
            txCount:         15,
            successRate:     15,
            accountAge:      15,
            counterparties:  15,
            selfBonus:       15,
            ensBonus:        5,
            consistencyBonus: 10,
            penalties:       -30
        });

        vm.prank(auditor);
        registry.updateScore(agent1, 60, b, "");
        assertEq(registry.getScore(agent1), 60);
    }

    // -----------------------------------------------------------------------
    // Human verification — Self Protocol integration
    // -----------------------------------------------------------------------

    function test_setHumanVerified_revertsIfNotSelfVerified() public {
        _register(agent1);
        // selfRegistry returns false for agent1 by default

        vm.prank(auditor);
        vm.expectRevert(TrustRegistry.NotSelfVerified.selector);
        registry.setHumanVerified(agent1, true);
    }

    function test_setHumanVerified_succeedsWhenSelfConfirms() public {
        _register(agent1);
        selfRegistry.setVerified(agent1, true);

        vm.prank(auditor);
        registry.setHumanVerified(agent1, true);

        assertTrue(registry.isHumanBacked(agent1));
    }

    function test_setHumanVerified_revocationNoSelfCheck() public {
        _register(agent1);
        selfRegistry.setVerified(agent1, true);

        vm.prank(auditor);
        registry.setHumanVerified(agent1, true);
        assertTrue(registry.isHumanBacked(agent1));

        // Revoke — Self Protocol state doesn't matter
        selfRegistry.setVerified(agent1, false);
        vm.prank(auditor);
        registry.setHumanVerified(agent1, false);
        assertFalse(registry.isHumanBacked(agent1));
    }

    function test_setHumanVerified_skipsCheckIfNoSelfRegistry() public {
        // Deploy with no Self registry
        TrustRegistry r = new TrustRegistry(auditor, address(0));
        vm.prank(agent1);
        r.registerAgent(0);

        // Should succeed without Self Protocol check
        vm.prank(auditor);
        r.setHumanVerified(agent1, true);
        assertTrue(r.isHumanBacked(agent1));
    }

    function test_setHumanVerified_revertsIfNotAuditor() public {
        _register(agent1);

        vm.prank(nobody);
        vm.expectRevert(TrustRegistry.NotAuditor.selector);
        registry.setHumanVerified(agent1, true);
    }

    function test_setHumanVerified_emitsEvent() public {
        _register(agent1);
        selfRegistry.setVerified(agent1, true);

        vm.expectEmit(true, false, false, true);
        emit HumanVerificationUpdated(agent1, true, block.timestamp);

        vm.prank(auditor);
        registry.setHumanVerified(agent1, true);
    }

    // -----------------------------------------------------------------------
    // Read functions
    // -----------------------------------------------------------------------

    function test_getTrustLevel() public {
        _register(agent1);
        TrustRegistry.ScoreBreakdown memory b = _emptyBreakdown();

        vm.startPrank(auditor);

        registry.updateScore(agent1, 10, b, "");
        assertEq(keccak256(bytes(registry.getTrustLevel(agent1))), keccak256("not_trusted"));

        vm.warp(block.timestamp + 1 hours + 1);
        registry.updateScore(agent1, 30, b, "");
        assertEq(keccak256(bytes(registry.getTrustLevel(agent1))), keccak256("caution"));

        vm.warp(block.timestamp + 1 hours + 1);
        registry.updateScore(agent1, 60, b, "");
        assertEq(keccak256(bytes(registry.getTrustLevel(agent1))), keccak256("trusted"));

        vm.warp(block.timestamp + 1 hours + 1);
        registry.updateScore(agent1, 85, b, "");
        assertEq(keccak256(bytes(registry.getTrustLevel(agent1))), keccak256("highly_trusted"));

        vm.stopPrank();
    }

    function test_getScores_batch() public {
        _register(agent1);
        _register(agent2);
        TrustRegistry.ScoreBreakdown memory b = _emptyBreakdown();

        vm.prank(auditor);
        registry.updateScore(agent1, 40, b, "");
        vm.warp(block.timestamp + 1 hours + 1);
        vm.prank(auditor);
        registry.updateScore(agent2, 80, b, "");

        address[] memory agents = new address[](2);
        agents[0] = agent1;
        agents[1] = agent2;

        uint256[] memory scores = registry.getScores(agents);
        assertEq(scores[0], 40);
        assertEq(scores[1], 80);
    }

    function test_getScore_returnsZeroForUnregistered() public view {
        // L-3: returns 0 for unregistered (not a revert)
        assertEq(registry.getScore(nobody), 0);
        assertFalse(registry.isRegistered(nobody));
    }

    function test_getAgentsPaginated() public {
        _register(agent1);
        _register(agent2);

        address[] memory page1 = registry.getAgentsPaginated(0, 1);
        assertEq(page1.length, 1);
        assertEq(page1[0], agent1);

        address[] memory page2 = registry.getAgentsPaginated(1, 1);
        assertEq(page2.length, 1);
        assertEq(page2[0], agent2);

        address[] memory empty = registry.getAgentsPaginated(10, 5);
        assertEq(empty.length, 0);
    }

    function test_totalAgents_derivedFromList() public {
        assertEq(registry.totalAgents(), 0);
        _register(agent1);
        assertEq(registry.totalAgents(), 1);
        _register(agent2);
        assertEq(registry.totalAgents(), 2);
    }

    // -----------------------------------------------------------------------
    // Deactivation (M-4)
    // -----------------------------------------------------------------------

    function test_deactivateAgent() public {
        _register(agent1);
        assertTrue(registry.isRegistered(agent1));

        registry.deactivateAgent(agent1);
        assertFalse(registry.isRegistered(agent1));
    }

    function test_deactivateAgent_emitsEvent() public {
        _register(agent1);

        vm.expectEmit(true, false, false, true);
        emit AgentDeactivated(agent1, block.timestamp);
        registry.deactivateAgent(agent1);
    }

    function test_deactivateAgent_preventsScoreUpdate() public {
        _register(agent1);
        registry.deactivateAgent(agent1);

        TrustRegistry.ScoreBreakdown memory b = _emptyBreakdown();
        vm.prank(auditor);
        vm.expectRevert(TrustRegistry.NotRegistered.selector);
        registry.updateScore(agent1, 50, b, "");
    }

    function test_deactivateAgent_revertsIfNotOwner() public {
        _register(agent1);

        vm.prank(nobody);
        vm.expectRevert(TrustRegistry.NotOwner.selector);
        registry.deactivateAgent(agent1);
    }

    function test_deactivateAgent_revertsIfAlreadyInactive() public {
        _register(agent1);
        registry.deactivateAgent(agent1);

        vm.expectRevert(TrustRegistry.NotRegistered.selector);
        registry.deactivateAgent(agent1);
    }

    // -----------------------------------------------------------------------
    // Admin
    // -----------------------------------------------------------------------

    function test_setAuditor() public {
        address newAuditor = makeAddr("newAuditor");

        vm.expectEmit(true, true, false, true);
        emit AuditorChanged(auditor, newAuditor);
        registry.setAuditor(newAuditor);

        assertEq(registry.auditor(), newAuditor);
    }

    function test_setAuditor_revertsIfNotOwner() public {
        vm.prank(nobody);
        vm.expectRevert(TrustRegistry.NotOwner.selector);
        registry.setAuditor(makeAddr("x"));
    }

    // H-1 fix: two-step ownership
    function test_transferOwnership_twoStep() public {
        address newOwner = makeAddr("newOwner");

        vm.expectEmit(true, true, false, false);
        emit OwnershipTransferProposed(owner, newOwner);
        registry.transferOwnership(newOwner);

        // Old owner still in control
        assertEq(registry.owner(), owner);
        assertEq(registry.pendingOwner(), newOwner);

        // New owner accepts
        vm.expectEmit(true, true, false, false);
        emit OwnershipTransferred(owner, newOwner);
        vm.prank(newOwner);
        registry.acceptOwnership();

        assertEq(registry.owner(), newOwner);
        assertEq(registry.pendingOwner(), address(0));
    }

    function test_transferOwnership_revertsIfNotOwner() public {
        vm.prank(nobody);
        vm.expectRevert(TrustRegistry.NotOwner.selector);
        registry.transferOwnership(makeAddr("x"));
    }

    function test_acceptOwnership_revertsIfNotPending() public {
        registry.transferOwnership(makeAddr("newOwner"));

        vm.prank(nobody);
        vm.expectRevert(TrustRegistry.NotPendingOwner.selector);
        registry.acceptOwnership();
    }

    function test_transferOwnership_revertsOnZeroAddress() public {
        vm.expectRevert(TrustRegistry.ZeroAddress.selector);
        registry.transferOwnership(address(0));
    }

    // -----------------------------------------------------------------------
    // Fuzz
    // -----------------------------------------------------------------------

    function testFuzz_scoreAlwaysCappedAt100(uint256 score) public {
        _register(agent1);
        TrustRegistry.ScoreBreakdown memory b = _emptyBreakdown();

        vm.prank(auditor);
        if (score > 100) {
            vm.expectRevert(TrustRegistry.ScoreOutOfRange.selector);
            registry.updateScore(agent1, score, b, "");
        } else {
            registry.updateScore(agent1, score, b, "");
            assertEq(registry.getScore(agent1), score);
        }
    }

    function testFuzz_breakdownFieldRanges(
        uint8 txCount,
        uint8 successRate,
        uint8 accountAge,
        uint8 counterparties
    ) public {
        _register(agent1);
        TrustRegistry.ScoreBreakdown memory b = TrustRegistry.ScoreBreakdown({
            txCount:         txCount,
            successRate:     successRate,
            accountAge:      accountAge,
            counterparties:  counterparties,
            selfBonus:       0,
            ensBonus:        0,
            consistencyBonus: 0,
            penalties:       0
        });

        vm.prank(auditor);
        bool shouldRevert = txCount > 15 || successRate > 15 || accountAge > 15 || counterparties > 15;

        if (shouldRevert) {
            vm.expectRevert(TrustRegistry.InvalidBreakdown.selector);
            registry.updateScore(agent1, 50, b, "");
        } else {
            registry.updateScore(agent1, 50, b, "");
        }
    }
}
