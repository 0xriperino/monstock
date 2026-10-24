// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockStock} from "../src/MockStock.sol";
import {MemeToken} from "../src/MemeToken.sol";
import {MemeMarket} from "../src/MemeMarket.sol";
import {StockBackFactory} from "../src/StockBackFactory.sol";
import {StockVault} from "../src/StockVault.sol";

/// @notice Integration uses every REAL contract, without a replacement Vault.
contract IntegrationTest is Test {
    MockStock stock;
    StockBackFactory factory;
    MemeToken meme;
    MemeMarket market;
    StockVault vault;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address treasury = address(0xFEE);

    function setUp() public {
        stock = new MockStock();
        factory = new StockBackFactory(address(stock), treasury);
        vm.startPrank(alice);
        stock.faucet();
        stock.approve(address(factory), 1000 ether);
        (address token_, address market_, address vault_) = factory.createCoin("Demo", "DEMO", 1000 ether);
        meme = MemeToken(token_);
        market = MemeMarket(market_);
        vault = StockVault(vault_);
        stock.approve(vault_, 100 ether);
        vault.deposit(100 ether, 90);
        vm.stopPrank();
        vm.startPrank(bob);
        stock.faucet();
        stock.approve(market_, type(uint256).max);
        vm.stopPrank();
    }

    function testFullDemoWithRealVaultAndLockedPositions() public {
        vm.startPrank(bob);
        market.buy(100 ether, market.quoteBuy(100 ether));
        uint256 sellAmount = meme.balanceOf(bob) / 2;
        meme.approve(address(market), sellAmount);
        market.sell(sellAmount, market.quoteSell(sellAmount));
        vm.stopPrank();
        uint256 fees = market.pendingHolderFees() + market.pendingVaultFees() + market.pendingTreasuryFees();
        vm.warp(market.nextEpochAt());
        market.settleEpoch();
        assertGt(vault.pendingRewards(0), 0);
        assertGt(stock.balanceOf(treasury), 0);
        assertApproxEqAbs(stock.balanceOf(treasury), fees / 2, 2);
        uint256 reward = market.pendingHolderRewards(bob);
        assertGt(reward, 0);
        uint256 before = stock.balanceOf(bob);
        vm.startPrank(bob);
        market.claimHolderRewards();
        assertEq(stock.balanceOf(bob), before + reward);
        market.claimHolderRewards();
        assertEq(stock.balanceOf(bob), before + reward);
        stock.approve(address(vault), reward + 50 ether);
        vault.deposit(reward, 30);
        vault.deposit(50 ether, 90);
        StockVault.Position[] memory positions = vault.getPositions(bob);
        assertEq(positions.length, 2);
        assertEq(positions[0].amount, reward);
        assertEq(positions[1].amount, 50 ether);
        assertEq(positions[0].unlockAt, block.timestamp + 30 days);
        vm.expectRevert(StockVault.PositionLocked.selector);
        vault.withdraw(positions[0].id);
        vm.stopPrank();
        vm.warp(positions[0].unlockAt);
        vm.prank(bob);
        vault.withdraw(positions[0].id);
        assertEq(stock.balanceOf(address(vault)), vault.totalPrincipal() + vault.rewardReserve());
        (uint256 reserve,) = market.getReserves();
        assertEq(stock.balanceOf(address(market)), reserve + market.holderRewardLiability());
    }

    function testEachMarketHasIndependentVaultAndRewards() public {
        vm.startPrank(alice);
        stock.approve(address(factory), 100 ether);
        (, address secondMarket, address secondVault) = factory.createCoin("Second", "TWO", 100 ether);
        vm.stopPrank();
        assertTrue(secondVault != address(vault));
        assertEq(StockVault(secondVault).market(), secondMarket);
        vm.prank(bob);
        market.buy(100 ether, 0);
        vm.warp(market.nextEpochAt());
        market.settleEpoch();
        assertGt(vault.rewardReserve(), 0);
        assertEq(StockVault(secondVault).rewardReserve(), 0);
        assertEq(stock.balanceOf(secondVault), 0);
    }

    function testEmptyRealVaultRoutesShareToTreasury() public {
        vm.startPrank(alice);
        stock.approve(address(factory), 100 ether);
        (, address pool, address emptyVault) = factory.createCoin("Empty Vault", "EMPTY", 100 ether);
        stock.approve(pool, 100 ether);
        MemeMarket(pool).buy(100 ether, 0);
        vm.stopPrank();
        vm.warp(MemeMarket(pool).nextEpochAt());
        MemeMarket(pool).settleEpoch();
        assertEq(stock.balanceOf(treasury), 0.6 ether);
        assertEq(stock.balanceOf(emptyVault), 0);
    }
}
