// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "forge-std/Script.sol";
import "../src/TrustRegistry.sol";

contract DeployTrustRegistry is Script {

    // Self Protocol Agent Registry addresses
    // Pass SELF_AGENT_REGISTRY env var to override. Defaults to address(0).
    //   Celo mainnet  (42220):    0xaC3DF9ABf80d0F5c020C06B04Cced27763355944
    //   Celo Sepolia  (11142220): 0x043DaCac8b0771DD5b444bCC88f2f8BBDBEdd379

    function run() external {
        uint256 deployerKey   = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address auditorWallet = vm.envAddress("AUDITOR_WALLET");

        // Optional: set SELF_AGENT_REGISTRY in .env to enable onchain ZK verification.
        // Defaults to address(0) (Self check disabled) if not set.
        address selfRegistry = vm.envOr("SELF_AGENT_REGISTRY", address(0));

        vm.startBroadcast(deployerKey);

        TrustRegistry registry = new TrustRegistry(auditorWallet, selfRegistry);

        console.log("TrustRegistry deployed at:", address(registry));
        console.log("  Owner:               ", registry.owner());
        console.log("  Auditor:             ", registry.auditor());
        console.log("  ERC-8004 Registry:   ", registry.ERC8004_REGISTRY());
        console.log("  Self Agent Registry: ", registry.SELF_AGENT_REGISTRY());

        vm.stopBroadcast();
    }
}
