// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/TrustRegistry.sol";

contract DeployTrustRegistry is Script {

    function run() external {
        // Load from environment
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address auditorWallet = vm.envAddress("AUDITOR_WALLET");

        vm.startBroadcast(deployerKey);

        TrustRegistry registry = new TrustRegistry(auditorWallet);

        console.log("TrustRegistry deployed at:", address(registry));
        console.log("  Owner:", registry.owner());
        console.log("  Auditor:", registry.auditor());
        console.log("  ERC-8004 Registry:", registry.ERC8004_REGISTRY());

        vm.stopBroadcast();
    }
}
