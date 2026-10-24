// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockQuoteAsset} from "../src/MockQuoteAsset.sol";
import {StockBackFactory} from "../src/StockBackFactory.sol";
import {MemeMarket} from "../src/MemeMarket.sol";
import {StockVault} from "../src/StockVault.sol";

contract MultiAssetTest is Test {
    MockQuoteAsset[4] assets;
    StockBackFactory[4] factories;
    MemeMarket[4] markets;
    StockVault[4] vaults;
    address treasury = address(0xFEE);

    function setUp() public {
        string[4] memory symbols = [string("PYDX"), "NVDAX", "GLDX", "ANTHROPIC"];
        for (uint256 i; i < 4; ++i) {
            assets[i] = new MockQuoteAsset(string.concat("Mock ", symbols[i]), symbols[i]);
            factories[i] = new StockBackFactory(address(assets[i]), treasury);
            assets[i].faucet();
            assets[i].approve(address(factories[i]), 1000 ether);
            (, address market, address vault) = factories[i].createCoin("Meme", "MEME", 1000 ether);
            markets[i] = MemeMarket(market);
            vaults[i] = StockVault(vault);
        }
    }

    function testEveryAssetHasIndependentFaucetAndPair() public {
        for (uint256 i; i < 4; ++i) {
            assertEq(assets[i].decimals(), 18);
            assertEq(assets[i].balanceOf(address(this)), 9000 ether);
            assertEq(address(markets[i].stockToken()), address(assets[i]));
            assertEq(address(vaults[i].stockToken()), address(assets[i]));
            vm.expectRevert("Already claimed");
            assets[i].faucet();
        }
    }

    function testApprovingAnotherAssetCannotFundPair() public {
        assets[0].approve(address(factories[1]), 100 ether);
        vm.expectRevert();
        factories[1].createCoin("Wrong asset", "WRONG", 100 ether);
        assets[0].approve(address(markets[1]), 100 ether);
        vm.expectRevert();
        markets[1].buy(100 ether, 0);
        assertEq(assets[0].balanceOf(address(markets[1])), 0);
    }

    function testFeesRewardsAndPrincipalStayInTheirOwnCurrency() public {
        for (uint256 i; i < 4; ++i) {
            assets[i].approve(address(vaults[i]), 100 ether);
            vaults[i].deposit(100 ether, 30);
            assets[i].approve(address(markets[i]), 100 ether);
            markets[i].buy(100 ether, 0);
        }
        vm.warp(markets[0].nextEpochAt());
        for (uint256 i; i < 4; ++i) {
            markets[i].settleEpoch();
            assertEq(vaults[i].totalPrincipal(), 100 ether);
            assertEq(vaults[i].rewardReserve(), 0.1 ether);
            assertEq(assets[i].balanceOf(treasury), 0.5 ether);
            for (uint256 j; j < 4; ++j) {
                if (i != j) {
                    assertEq(assets[j].balanceOf(address(vaults[i])), 0);
                    assertEq(assets[j].balanceOf(address(markets[i])), 0);
                }
            }
        }
    }
}
