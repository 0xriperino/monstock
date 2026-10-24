// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockQuoteAsset} from "../src/MockQuoteAsset.sol";
import {StockBackFactory} from "../src/StockBackFactory.sol";
import {BondingCurveFactory} from "../src/BondingCurveFactory.sol";
import {BondingCurveLauncher} from "../src/BondingCurveLauncher.sol";
import {BondingCurveMarket} from "../src/BondingCurveMarket.sol";
import {MemeToken} from "../src/MemeToken.sol";
import {StockVault} from "../src/StockVault.sol";

contract BondingCurveTest is Test {
    MockQuoteAsset asset;
    BondingCurveLauncher launcher;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address treasury = address(0xFEE);

    function setUp() public {
        asset = new MockQuoteAsset("NVIDIA", "NVDAX");
        address[] memory factories = new address[](1);
        factories[0] = address(new StockBackFactory(address(asset), treasury));
        launcher = new BondingCurveLauncher(factories, address(new BondingCurveFactory(treasury)));
        vm.prank(alice);
        asset.faucet();
        vm.prank(bob);
        asset.faucet();
    }

    function params(uint256 fee) internal view returns (BondingCurveLauncher.LaunchParams memory) {
        return BondingCurveLauncher.LaunchParams(
            address(asset), "Curve Cat", "CCAT", fee, 0, 0, '{"website":"https://example.com"}'
        );
    }

    function launch(uint256 fee) internal returns (MemeToken token, BondingCurveMarket market, StockVault vault) {
        vm.prank(alice);
        (address t, address m, address v) = launcher.launch(params(fee));
        return (MemeToken(t), BondingCurveMarket(m), StockVault(v));
    }

    function solvent(BondingCurveMarket market) internal view {
        (uint256 realQuote, uint256 inventory) = market.getReserves();
        assertEq(
            asset.balanceOf(address(market)),
            realQuote + market.pendingHolderFees() + market.pendingVaultFees() + market.pendingTreasuryFees()
                + market.holderRewardLiability()
        );
        assertEq(MemeToken(address(market.memeToken())).balanceOf(address(market)), inventory);
    }

    function testLaunchNeedsNoQuoteTokensOrApproval() public {
        address emptyWallet = address(0xCAFE);
        vm.prank(emptyWallet);
        (address token, address market,) = launcher.launch(params(100));
        (uint256 realQuote, uint256 inventory) = BondingCurveMarket(market).getReserves();
        assertEq(realQuote, 0);
        assertEq(inventory, 1_000_000 ether);
        assertEq(asset.balanceOf(emptyWallet), 0);
        assertEq(asset.balanceOf(market), 0);
        assertEq(launcher.creatorOf(token), emptyWallet);
        assertGt(BondingCurveMarket(market).quoteBuy(1 ether), 0);
        vm.expectRevert("Insufficient curve backing");
        BondingCurveMarket(market).quoteSell(1 ether);
    }

    function testPriceRisesOnBuyAndFallsOnSellForBothFees() public {
        for (uint256 i; i < 2; ++i) {
            uint256 fee = i == 0 ? 100 : 300;
            (MemeToken token, BondingCurveMarket market,) = launch(fee);
            uint256 before = market.quoteBuy(10 ether);
            vm.startPrank(alice);
            asset.approve(address(market), 100 ether);
            market.buy(100 ether, market.quoteBuy(100 ether));
            uint256 afterBuy = market.quoteBuy(10 ether);
            assertLt(afterBuy, before);
            assertEq(market.pendingHolderFees(), (100 ether * fee / 10_000) * 40 / 100);
            token.approve(address(market), token.balanceOf(alice));
            market.sell(token.balanceOf(alice), 0);
            vm.stopPrank();
            assertGt(market.quoteBuy(10 ether), afterBuy);
            solvent(market);
        }
    }

    function testFuzzMultipleBuyersCanRedeemAllWithoutVirtualMoney(uint96 x, uint96 y, bool threePercent) public {
        (MemeToken token, BondingCurveMarket market,) = launch(threePercent ? 300 : 100);
        uint256 first = bound(uint256(x), 1e6, 4000 ether);
        uint256 second = bound(uint256(y), 1e6, 4000 ether);
        vm.startPrank(alice);
        asset.approve(address(market), first);
        market.buy(first, 0);
        vm.stopPrank();
        vm.startPrank(bob);
        asset.approve(address(market), second);
        market.buy(second, 0);
        vm.stopPrank();
        solvent(market);
        vm.startPrank(alice);
        token.approve(address(market), token.balanceOf(alice));
        market.sell(token.balanceOf(alice), 0);
        vm.stopPrank();
        solvent(market);
        vm.startPrank(bob);
        token.approve(address(market), token.balanceOf(bob));
        market.sell(token.balanceOf(bob), 0);
        vm.stopPrank();
        solvent(market);
        (, uint256 inventory) = market.getReserves();
        assertEq(inventory, token.totalSupply());
        assertLe(asset.balanceOf(alice) + asset.balanceOf(bob), 20_000 ether);
    }

    function testRewardsAndVaultCannotSpendCurveBacking() public {
        (MemeToken token, BondingCurveMarket market, StockVault vault) = launch(300);
        vm.startPrank(bob);
        asset.approve(address(vault), 100 ether);
        vault.deposit(100 ether, 30);
        vm.stopPrank();
        vm.startPrank(alice);
        asset.approve(address(market), 100 ether);
        market.buy(100 ether, 0);
        vm.stopPrank();
        vm.warp(market.nextEpochAt());
        market.settleEpoch();
        assertEq(vault.rewardReserve(), 0.3 ether);
        assertEq(asset.balanceOf(treasury), 1.5 ether);
        solvent(market);
        vm.startPrank(alice);
        market.claimHolderRewards();
        token.approve(address(market), token.balanceOf(alice));
        market.sell(token.balanceOf(alice), 0);
        vm.stopPrank();
        solvent(market);
        assertEq(vault.totalPrincipal(), 100 ether);
    }

    function testAtomicDevBuyAndSlippageRollback() public {
        BondingCurveLauncher.LaunchParams memory p = params(300);
        p.devBuy = 100 ether;
        vm.startPrank(alice);
        asset.approve(address(launcher), 100 ether);
        p.minMemeOut = 1_000_000 ether;
        vm.expectRevert();
        launcher.launch(p);
        assertEq(launcher.getMarkets(address(asset)).length, 0);
        assertEq(asset.balanceOf(alice), 10_000 ether);
        p.minMemeOut = 0;
        (address token, address market,) = launcher.launch(p);
        vm.stopPrank();
        assertGt(MemeToken(token).balanceOf(alice), 0);
        assertEq(asset.balanceOf(alice), 9900 ether);
        assertEq(asset.balanceOf(address(launcher)), 0);
        assertEq(MemeToken(token).balanceOf(address(launcher)), 0);
        solvent(BondingCurveMarket(market));
    }

    function testDonationsDoNotMovePriceAndInitializationIsRestricted() public {
        (, BondingCurveMarket market, StockVault vault) = launch(100);
        uint256 before = market.quoteBuy(10 ether);
        vm.prank(alice);
        asset.transfer(address(market), 10 ether);
        assertEq(market.quoteBuy(10 ether), before);
        (uint256 realQuote,) = market.getReserves();
        assertEq(realQuote, 0);
        vm.expectRevert("Factory only");
        market.initialize(address(vault), 0);
        vm.expectRevert("MemeToken only");
        market.checkpoint(alice, bob);
    }

    function testDevBuyLimitAndUnsupportedFeeRevertAtomically() public {
        BondingCurveLauncher.LaunchParams memory p = params(300);
        p.devBuy = 4000 ether;
        vm.startPrank(alice);
        asset.approve(address(launcher), p.devBuy);
        vm.expectRevert("Dev buy exceeds 75%");
        launcher.launch(p);
        p.devBuy = 0;
        p.feeBps = 200;
        vm.expectRevert("Choose 1% or 3%");
        launcher.launch(p);
        vm.stopPrank();
        assertEq(asset.balanceOf(alice), 10_000 ether);
        assertEq(launcher.getMarkets(address(asset)).length, 0);
    }
}
