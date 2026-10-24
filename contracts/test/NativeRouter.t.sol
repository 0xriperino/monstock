// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockQuoteAsset} from "../src/MockQuoteAsset.sol";
import {StockBackFactory} from "../src/StockBackFactory.sol";
import {BondingCurveFactory} from "../src/BondingCurveFactory.sol";
import {BondingCurveLauncher} from "../src/BondingCurveLauncher.sol";
import {BondingCurveMarket} from "../src/BondingCurveMarket.sol";
import {NativeRouter} from "../src/NativeRouter.sol";
import {MemeToken} from "../src/MemeToken.sol";

contract NativeRouterTest is Test {
    MockQuoteAsset asset;
    BondingCurveLauncher launcher;
    NativeRouter router;
    MemeToken token;
    BondingCurveMarket market;
    address alice = address(0xA11CE);

    function setUp() public {
        asset = new MockQuoteAsset("NVIDIA", "NVDAX");
        address[] memory factories = new address[](1);
        factories[0] = address(new StockBackFactory(address(asset), address(0xFEE)));
        launcher = new BondingCurveLauncher(factories, address(new BondingCurveFactory(address(0xFEE))));
        router = new NativeRouter(address(launcher), new address[](0));
        router.seedQuote(address(asset));
        vm.deal(alice, 100 ether);
        (address t, address m,) = launcher.launch(params(0));
        token = MemeToken(t);
        market = BondingCurveMarket(m);
    }

    function params(uint256 buy) internal view returns (BondingCurveLauncher.LaunchParams memory) {
        return BondingCurveLauncher.LaunchParams(
            address(asset), "MON Cat", "MCAT", 300, buy, 0, '{"website":"https://example.com"}'
        );
    }

    function testBuyAndSellWithoutUserHoldingQuoteAsset() public {
        (uint256 expected,) = router.quoteBuyMON(address(market), 0.1 ether);
        vm.prank(alice);
        router.buyMON{value: 0.1 ether}(address(market), expected, block.timestamp + 45);
        assertEq(asset.balanceOf(alice), 0);
        assertEq(token.balanceOf(alice), expected);
        assertEq(token.balanceOf(address(router)), 0);
        assertEq(market.pendingHolderFees(), 1.2 ether);
        uint256 before = alice.balance;
        (uint256 monOut,) = router.quoteSellMON(address(market), expected);
        vm.startPrank(alice);
        token.approve(address(router), expected);
        router.sellMON(address(market), expected, monOut, block.timestamp + 45);
        vm.stopPrank();
        assertEq(alice.balance, before + monOut);
        assertEq(token.balanceOf(alice), 0);
        assertEq(asset.balanceOf(alice), 0);
        assertLe(alice.balance, 100 ether);
    }

    function testExactTokenBuyRefundsUnusedMaximum() public {
        uint256 wanted = 10_000 ether;
        (uint256 cost,, uint256 output) = router.quoteBuyTokens(address(market), wanted);
        uint256 before = alice.balance;
        vm.prank(alice);
        router.buyTokens{value: cost + 1 ether}(address(market), wanted, block.timestamp + 45);
        assertEq(before - alice.balance, cost);
        assertEq(token.balanceOf(alice), output);
        assertGe(output, wanted);
        assertEq(address(router).balance, cost);
    }

    function testAtomicLaunchAndFirstBuyWithMON() public {
        BondingCurveLauncher.LaunchParams memory p = params(100 ether);
        uint256 cost = router.nativeCost(p.devBuy);
        vm.prank(alice);
        (address t, address m,) = router.launchMON{value: cost}(p, block.timestamp + 45);
        assertEq(router.creatorOf(t), alice);
        assertEq(launcher.metadata(t), p.metadataJSON);
        assertGt(MemeToken(t).balanceOf(alice), 0);
        assertEq(MemeToken(t).balanceOf(address(router)), 0);
        assertEq(asset.balanceOf(alice), 0);
        assertEq(launcher.getMarkets(address(asset))[1], m);
    }

    function testExpiredAndBadMinimumRollbackMONAndTokens() public {
        uint256 before = alice.balance;
        vm.prank(alice);
        vm.expectRevert("Quote expired");
        router.buyMON{value: 0.1 ether}(address(market), 0, block.timestamp - 1);
        vm.prank(alice);
        vm.expectRevert("Slippage or zero output");
        router.buyMON{value: 0.1 ether}(address(market), 1_000_000 ether, block.timestamp + 45);
        assertEq(alice.balance, before);
        assertEq(token.balanceOf(alice), 0);
        assertEq(asset.balanceOf(address(router)), 10_000 ether);
    }

    function testUnregisteredMarketCannotDrainConversionReserves() public {
        BondingCurveMarket fake =
            new BondingCurveMarket(address(token), address(asset), address(0xFEE), address(this), 100);
        vm.prank(alice);
        vm.expectRevert("Unregistered market");
        router.buyMON{value: 0.1 ether}(address(fake), 0, block.timestamp + 45);
        assertEq(asset.balanceOf(address(router)), 10_000 ether);
    }

    function testReserveShortageAndDevBuyLimitRevertEntireLaunch() public {
        vm.prank(alice);
        vm.expectRevert("Conversion quote reserve unavailable");
        router.buyMON{value: 11 ether}(address(market), 0, block.timestamp + 45);
        uint256 count = launcher.getMarkets(address(asset)).length;
        vm.prank(alice);
        vm.expectRevert("Dev buy exceeds 75%");
        router.launchMON{value: 4 ether}(params(4000 ether), block.timestamp + 45);
        assertEq(launcher.getMarkets(address(asset)).length, count);
    }

    function testFuzzExactOutputNeverUnderDelivers(uint96 wanted_) public {
        uint256 wanted = bound(uint256(wanted_), 1, 700_000 ether);
        (uint256 cost,, uint256 output) = router.quoteBuyTokens(address(market), wanted);
        vm.prank(alice);
        router.buyTokens{value: cost}(address(market), wanted, block.timestamp + 45);
        assertEq(token.balanceOf(alice), output);
        assertGe(output, wanted);
    }
}
