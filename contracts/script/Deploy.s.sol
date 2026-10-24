// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {MockStock} from "../src/MockStock.sol";
import {StockBackFactory} from "../src/StockBackFactory.sol";

contract Deploy is Script {
    function run() external {
        require(block.chainid == 10143 || block.chainid == 31337, "Test networks only");
        uint256 key = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(key);
        address treasury = vm.envOr("TREASURY_ADDRESS", deployer);
        vm.startBroadcast(key);
        MockStock stock = new MockStock();
        StockBackFactory factory = new StockBackFactory(address(stock), treasury);
        stock.faucet();
        stock.approve(address(factory), 1000 ether);
        factory.createCoin("StockBack Demo", "SBDEMO", 1000 ether);
        vm.stopBroadcast();
        // Export only successful --broadcast receipts with export-deployment.mjs.
    }
}
