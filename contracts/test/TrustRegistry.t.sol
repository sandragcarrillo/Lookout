// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/TrustRegistry.sol";

contract TrustRegistryTest is Test {

    // Mirror events from TrustRegistry for vm.expectEmit
    event AgentRegistered(address indexed agent, uint256 erc8004Id, uint256 timestamp);
    event ScoreUpdated(address indexed agent, uint256 oldScore, uint256 newScore, string reportCID, uint256 timestamp);

    TrustRegistry public registry;

    address owner = address(this);
    address auditor = makeAddr("auditor");
    address agent1 = makeAddr("agent1");
    address agent2 = makeAddr("agent2");
    address nobody = makeAddr("nobody");

    function setUp() public {
        registry = new TrustRegistry(auditor);
    }

    // ---------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------

    function test_constructor_setsOwnerAndAuditor() public view {
        assertEq(registry.owner(), owner);
        assertEq(registry.auditor(), auditor);
    }

    function test_constructor_revertsOnZeroAuditor() public {
        vm.expectRevert(TrustRegistry.ZeroAddress.selector);
        new TrustRegistry(address(0));
    }

    // ---------------------------------------------------------------
    // Registration
    // ---------------------------------------------------------------

    function test_registerAgent_basic() public {
        registry.registerAgent(agent1, 0);
        assertTrue(registry.isRegistered(agent1));
        assertEq(registry.totalAgents(), 1);
    }

    function test_registerAgent_emitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit AgentRegistered(agent1, 0, block.timestamp);
        registry.registerAgent(agent1, 0);
    }

    function test_registerAgent_revertsIfAlreadyRegistered() public {
        registry.registerAgent(agent1, 0);
        vm.expectRevert(TrustRegistry.AlreadyRegistered.selector);
        registry.registerAgent(agent1, 0);
    }

    function test_registerAgent_revertsOnZeroAddress() public {
        vm.expectRevert(TrustRegistry.ZeroAddress.selector);
        registry.registerAgent(address(0), 0);
    }

    function test_registerMultipleAgents() public {
        registry.registerAgent(agent1, 0);
        registry.registerAgent(agent2, 0);
        assertEq(registry.totalAgents(), 2);

        address[] memory all = registry.getAllAgents();
        assertEq(all.length, 2);
        assertEq(all[0], agent1);
        assertEq(all[1], agent2);
    }

    // ---------------------------------------------------------------
    // Scoring
    // ---------------------------------------------------------------

    function test_updateScore_works() public {
        registry.registerAgent(agent1, 0);

        TrustRegistry.ScoreBreakdown memory b = TrustRegistry.ScoreBreakdown({
            txCount: 12,
            successRate: 14,
            accountAge: 10,
            counterparties: 8,
            selfBonus: 0,
            ensBonus: 0,
            consistencyBonus: 7,
            penalties: -2
        });

        vm.prank(auditor);
        registry.updateScore(agent1, 49, b, "QmTestReportCID");

        assertEq(registry.getScore(agent1), 49);

        TrustRegistry.AgentProfile memory p = registry.getFullProfile(agent1);
        assertEq(p.breakdown.txCount, 12);
        assertEq(p.breakdown.successRate, 14);
        assertEq(p.breakdown.penalties, -2);
        assertEq(p.auditCount, 1);
        assertEq(keccak256(bytes(p.latestReportCID)), keccak256(bytes("QmTestReportCID")));
    }

    function test_updateScore_revertsIfNotAuditor() public {
        registry.registerAgent(agent1, 0);

        TrustRegistry.ScoreBreakdown memory b;

        vm.prank(nobody);
        vm.expectRevert(TrustRegistry.NotAuditor.selector);
        registry.updateScore(agent1, 50, b, "");
    }

    function test_updateScore_revertsIfNotRegistered() public {
        TrustRegistry.ScoreBreakdown memory b;

        vm.prank(auditor);
        vm.expectRevert(TrustRegistry.NotRegistered.selector);
        registry.updateScore(agent1, 50, b, "");
    }

    function test_updateScore_revertsIfScoreOver100() public {
        registry.registerAgent(agent1, 0);
        TrustRegistry.ScoreBreakdown memory b;

        vm.prank(auditor);
        vm.expectRevert(TrustRegistry.ScoreOutOfRange.selector);
        registry.updateScore(agent1, 101, b, "");
    }

    function test_updateScore_emitsWithOldAndNew() public {
        registry.registerAgent(agent1, 0);
        TrustRegistry.ScoreBreakdown memory b;

        vm.prank(auditor);
        registry.updateScore(agent1, 30, b, "QmFirst");

        vm.expectEmit(true, false, false, true);
        emit ScoreUpdated(agent1, 30, 75, "QmSecond", block.timestamp);

        vm.prank(auditor);
        registry.updateScore(agent1, 75, b, "QmSecond");
    }

    function test_updateScore_incrementsAuditCount() public {
        registry.registerAgent(agent1, 0);
        TrustRegistry.ScoreBreakdown memory b;

        vm.startPrank(auditor);
        registry.updateScore(agent1, 30, b, "");
        registry.updateScore(agent1, 50, b, "");
        registry.updateScore(agent1, 70, b, "");
        vm.stopPrank();

        TrustRegistry.AgentProfile memory p = registry.getFullProfile(agent1);
        assertEq(p.auditCount, 3);
        assertEq(registry.totalAudits(), 3);
    }

    // ---------------------------------------------------------------
    // Human verification
    // ---------------------------------------------------------------

    function test_setHumanVerified() public {
        registry.registerAgent(agent1, 0);

        vm.prank(auditor);
        registry.setHumanVerified(agent1, true);

        assertTrue(registry.isHumanBacked(agent1));
    }

    function test_setHumanVerified_revertsIfNotAuditor() public {
        registry.registerAgent(agent1, 0);

        vm.prank(nobody);
        vm.expectRevert(TrustRegistry.NotAuditor.selector);
        registry.setHumanVerified(agent1, true);
    }

    // ---------------------------------------------------------------
    // Read functions
    // ---------------------------------------------------------------

    function test_getTrustLevel() public {
        registry.registerAgent(agent1, 0);
        TrustRegistry.ScoreBreakdown memory b;

        vm.startPrank(auditor);

        registry.updateScore(agent1, 10, b, "");
        assertEq(keccak256(bytes(registry.getTrustLevel(agent1))), keccak256("not_trusted"));

        registry.updateScore(agent1, 30, b, "");
        assertEq(keccak256(bytes(registry.getTrustLevel(agent1))), keccak256("caution"));

        registry.updateScore(agent1, 60, b, "");
        assertEq(keccak256(bytes(registry.getTrustLevel(agent1))), keccak256("trusted"));

        registry.updateScore(agent1, 85, b, "");
        assertEq(keccak256(bytes(registry.getTrustLevel(agent1))), keccak256("highly_trusted"));

        vm.stopPrank();
    }

    function test_getScores_batch() public {
        registry.registerAgent(agent1, 0);
        registry.registerAgent(agent2, 0);
        TrustRegistry.ScoreBreakdown memory b;

        vm.startPrank(auditor);
        registry.updateScore(agent1, 40, b, "");
        registry.updateScore(agent2, 80, b, "");
        vm.stopPrank();

        address[] memory agents = new address[](2);
        agents[0] = agent1;
        agents[1] = agent2;

        uint256[] memory scores = registry.getScores(agents);
        assertEq(scores[0], 40);
        assertEq(scores[1], 80);
    }

    function test_getAgentsPaginated() public {
        registry.registerAgent(agent1, 0);
        registry.registerAgent(agent2, 0);

        address[] memory page1 = registry.getAgentsPaginated(0, 1);
        assertEq(page1.length, 1);
        assertEq(page1[0], agent1);

        address[] memory page2 = registry.getAgentsPaginated(1, 1);
        assertEq(page2.length, 1);
        assertEq(page2[0], agent2);

        // Out of bounds
        address[] memory empty = registry.getAgentsPaginated(10, 5);
        assertEq(empty.length, 0);
    }

    // ---------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------

    function test_setAuditor() public {
        address newAuditor = makeAddr("newAuditor");
        registry.setAuditor(newAuditor);
        assertEq(registry.auditor(), newAuditor);
    }

    function test_setAuditor_revertsIfNotOwner() public {
        vm.prank(nobody);
        vm.expectRevert(TrustRegistry.NotOwner.selector);
        registry.setAuditor(makeAddr("x"));
    }

    function test_transferOwnership() public {
        address newOwner = makeAddr("newOwner");
        registry.transferOwnership(newOwner);
        assertEq(registry.owner(), newOwner);
    }

    // ---------------------------------------------------------------
    // Fuzz
    // ---------------------------------------------------------------

    function testFuzz_scoreAlwaysCappedAt100(uint256 score) public {
        registry.registerAgent(agent1, 0);
        TrustRegistry.ScoreBreakdown memory b;

        vm.prank(auditor);

        if (score > 100) {
            vm.expectRevert(TrustRegistry.ScoreOutOfRange.selector);
            registry.updateScore(agent1, score, b, "");
        } else {
            registry.updateScore(agent1, score, b, "");
            assertEq(registry.getScore(agent1), score);
        }
    }
}
