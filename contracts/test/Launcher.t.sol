// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockQuoteAsset} from "../src/MockQuoteAsset.sol";
import {StockBackFactory} from "../src/StockBackFactory.sol";
import {RewardFactory} from "../src/RewardFactory.sol";
import {StockBackLauncher} from "../src/StockBackLauncher.sol";
import {MemeMarket} from "../src/MemeMarket.sol";
import {MemeToken} from "../src/MemeToken.sol";
import {StockVault} from "../src/StockVault.sol";

contract LauncherTest is Test {
    MockQuoteAsset asset;
    StockBackFactory factory;
    StockBackLauncher launcher;
    address alice = address(0xA11CE);

    function setUp() public {
        asset = new MockQuoteAsset("Mock NVIDIA", "NVDAX");
        factory = new StockBackFactory(address(asset), address(0xFEE));
        address[] memory factories = new address[](1);
        factories[0] = address(factory);
        launcher = new StockBackLauncher(factories, address(new RewardFactory(address(0xFEE))));
        vm.startPrank(alice);
        asset.faucet();
        asset.approve(address(launcher), type(uint256).max);
        vm.stopPrank();
    }

    function params() internal view returns (StockBackLauncher.LaunchParams memory) {
        return StockBackLauncher.LaunchParams(
            address(asset),
            "NVIDIA Cat",
            "NCAT",
            1000 ether,
            100,
            100 ether,
            0,
            '{"website":"https://example.com","image":"data:image/webp;base64,AA=="}'
        );
    }

    function testAtomicFirstBuyAndPermanentMetadata() public {
        StockBackLauncher.LaunchParams memory p = params();
        vm.prank(alice);
        (address token, address market, address vault) = launcher.launch(p);
        assertEq(launcher.creatorOf(token), alice);
        assertEq(launcher.metadata(token), p.metadataJSON);
        assertGt(MemeToken(token).balanceOf(alice), 0);
        assertEq(MemeToken(token).balanceOf(address(launcher)), 0);
        assertEq(asset.balanceOf(address(launcher)), 0);
        assertEq(asset.balanceOf(alice), 8900 ether);
        assertEq(asset.allowance(address(launcher), address(launcher.rewardFactory())), 0);
        assertEq(asset.allowance(address(launcher), market), 0);
        assertEq(StockVault(vault).market(), market);
        assertEq(launcher.getMarkets(address(asset))[0], market);
        assertEq(MemeMarket(market).pendingHolderFees(), 0.4 ether);
    }

    function testNoDevBuyLeavesAllSupplyInMarket() public {
        StockBackLauncher.LaunchParams memory p = params();
        p.devBuy = 0;
        vm.prank(alice);
        (address token, address market,) = launcher.launch(p);
        assertEq(MemeToken(token).balanceOf(market), 1_000_000 ether);
        assertEq(MemeToken(token).balanceOf(alice), 0);
    }

    function testSlippageFailureRevertsEntireLaunchAndFunds() public {
        StockBackLauncher.LaunchParams memory p = params();
        p.minMemeOut = 1_000_000 ether;
        vm.prank(alice);
        vm.expectRevert();
        launcher.launch(p);
        assertEq(launcher.getMarkets(address(asset)).length, 0);
        assertEq(asset.balanceOf(alice), 10_000 ether);
    }

    function testRejectsOversizedMetadataUnknownAssetAndOversizedDevBuy() public {
        StockBackLauncher.LaunchParams memory p = params();
        p.metadataJSON = new string(16_385);
        vm.expectRevert("Metadata too large");
        launcher.launch(p);
        p = params();
        p.quoteAsset = address(0xBAD);
        vm.expectRevert("Unsupported quote asset");
        launcher.launch(p);
        p = params();
        p.devBuy = 4000 ether;
        vm.prank(alice);
        vm.expectRevert("Dev buy exceeds 75%");
        launcher.launch(p);
        assertEq(launcher.getMarkets(address(asset)).length, 0);
        assertEq(asset.balanceOf(alice), 10_000 ether);
    }

    function testApprovalForFactoryDoesNotAuthorizeLauncher() public {
        vm.startPrank(alice);
        asset.approve(address(launcher), 0);
        asset.approve(address(factory), 2000 ether);
        vm.expectRevert();
        launcher.launch(params());
        vm.stopPrank();
    }

    function testBothFeeOptionsChargeAndDistributeCorrectlyOnBuyAndSell() public {
        for (uint256 i; i < 2; ++i) {
            StockBackLauncher.LaunchParams memory p = params();
            p.feeBps = i == 0 ? 100 : 300;
            vm.prank(alice);
            (address token, address pool,) = launcher.launch(p);
            MemeMarket market = MemeMarket(pool);
            assertEq(market.tradingFeeBps(), p.feeBps);
            uint256 buyFee = p.devBuy * p.feeBps / 10_000;
            assertEq(market.pendingHolderFees(), buyFee * 40 / 100);
            assertEq(market.pendingVaultFees(), buyFee / 10);
            assertEq(market.pendingTreasuryFees(), buyFee / 2);
            (uint256 quoteReserve, uint256 memeReserve) = market.getReserves();
            uint256 sellAmount = MemeToken(token).balanceOf(alice) / 2;
            uint256 gross = quoteReserve * sellAmount / (memeReserve + sellAmount);
            uint256 sellFee = gross * p.feeBps / 10_000;
            uint256 expected = gross - sellFee;
            assertEq(market.quoteSell(sellAmount), expected);
            uint256 before = asset.balanceOf(alice);
            vm.startPrank(alice);
            MemeToken(token).approve(pool, sellAmount);
            market.sell(sellAmount, expected);
            vm.stopPrank();
            assertEq(asset.balanceOf(alice), before + expected);
            assertEq(market.pendingHolderFees(), buyFee * 40 / 100 + sellFee * 40 / 100);
        }
    }

    function testUnsupportedFeeRevertsBeforeAnyLaunchPersists() public {
        StockBackLauncher.LaunchParams memory p = params();
        p.feeBps = 200;
        vm.prank(alice);
        vm.expectRevert("Choose 1% or 3%");
        launcher.launch(p);
        assertEq(asset.balanceOf(alice), 10_000 ether);
        assertEq(launcher.getMarkets(address(asset)).length, 0);
    }
}
