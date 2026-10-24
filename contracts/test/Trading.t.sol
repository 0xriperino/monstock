// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockStock} from "../src/MockStock.sol";
import {MemeToken} from "../src/MemeToken.sol";
import {MemeMarket} from "../src/MemeMarket.sol";

interface ITradingFactory {
    function createCoin(string calldata, string calldata, uint256) external returns (address, address, address);
    function getMarkets() external view returns (address[] memory);
}

// Test double only: the real StockVault belongs to Developer 2.
// Enforces transfer-before-notify and the agreed market-only notification boundary.
contract RewardVaultDouble {
    MockStock public stock;
    address public market;
    uint256 public totalWeight;
    uint256 public notified;
    bool public attemptReentry;

    constructor(MockStock stock_, address market_) {
        stock = stock_;
        market = market_;
    }

    function setWeight(uint256 weight) external {
        totalWeight = weight;
    }

    function enableReentry() external {
        attemptReentry = true;
    }

    function notifyReward(uint256 amount) external {
        require(msg.sender == market, "market only");
        require(stock.balanceOf(address(this)) >= notified + amount, "transfer first");
        if (attemptReentry) {
            _checkGuard(abi.encodeWithSignature("settleEpoch()"));
            _checkGuard(abi.encodeWithSignature("claimHolderRewards()"));
            _checkGuard(abi.encodeWithSignature("buy(uint256,uint256)", 1 ether, 0));
            _checkGuard(abi.encodeWithSignature("sell(uint256,uint256)", 1 ether, 0));
        }
        notified += amount;
    }

    function _checkGuard(bytes memory data) private {
        (bool ok, bytes memory reason) = market.call(data);
        require(!ok && bytes4(reason) == bytes4(keccak256("ReentrancyGuardReentrantCall()")), "Reentry not guarded");
    }
}

abstract contract TradingFixture is Test {
    MockStock internal stock;
    MemeToken internal meme;
    MemeMarket internal market;
    RewardVaultDouble internal rewardVault;
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);
    address internal treasury = address(0xFEE);

    function setUp() public virtual {
        stock = new MockStock();
        meme = new MemeToken("Demo Meme", "MEME");
        market = new MemeMarket(address(meme), address(stock), treasury, address(this));
        rewardVault = new RewardVaultDouble(stock, address(market));
        meme.registerMarket(address(market));
        stock.faucet();
        stock.transfer(address(market), 1000 ether);
        meme.transfer(address(market), 1_000_000 ether);
        market.initialize(address(rewardVault), 1000 ether);
        vm.startPrank(alice);
        stock.faucet();
        stock.approve(address(market), type(uint256).max);
        vm.stopPrank();
        vm.startPrank(bob);
        stock.faucet();
        stock.approve(address(market), type(uint256).max);
        vm.stopPrank();
    }

    function buyAs(address user, uint256 amount) internal {
        vm.prank(user);
        market.buy(amount, 0);
    }

    function settle() internal {
        vm.warp(market.nextEpochAt());
        market.settleEpoch();
    }

    function assertSolvent() internal view {
        (uint256 s, uint256 m) = market.getReserves();
        assertGe(stock.balanceOf(address(market)), s);
        assertGe(meme.balanceOf(address(market)), m);
        assertEq(
            stock.balanceOf(address(market)),
            s + market.pendingHolderFees() + market.pendingVaultFees() + market.pendingTreasuryFees()
                + market.holderRewardLiability()
        );
    }
}

contract TradingTest is TradingFixture {
    function testFaucetOnceAndFixedSupply() public {
        assertEq(stock.balanceOf(alice), 10_000 ether);
        vm.prank(alice);
        vm.expectRevert();
        stock.faucet();
        assertEq(meme.totalSupply(), 1_000_000 ether);
        assertEq(meme.balanceOf(address(market)), 1_000_000 ether);
    }

    function testBuyFeeAndQuote() public {
        // 100 stock pays 1 fee; 99 enters liquidity. floor(1e24 * 99 / 1099).
        uint256 expected = 90_081_892_629_663_330_300_272;
        assertEq(market.quoteBuy(100 ether), expected);
        vm.prank(alice);
        market.buy(100 ether, expected);
        assertEq(meme.balanceOf(alice), expected);
        assertEq(stock.balanceOf(alice), 9900 ether);
        (uint256 s, uint256 m) = market.getReserves();
        assertEq(s, 1099 ether);
        assertEq(m, 1_000_000 ether - expected);
        assertEq(stock.balanceOf(address(market)) - s, 1 ether);
        assertSolvent();
    }

    function testSellFeeAndQuote() public {
        buyAs(alice, 100 ether);
        uint256 tokens = meme.balanceOf(alice);
        uint256 quote = market.quoteSell(tokens);
        assertApproxEqAbs(quote, 98.01 ether, 2);
        vm.startPrank(alice);
        meme.approve(address(market), tokens);
        market.sell(tokens, quote);
        vm.stopPrank();
        assertEq(meme.balanceOf(alice), 0);
        assertEq(stock.balanceOf(alice), 9900 ether + quote);
        (uint256 s, uint256 m) = market.getReserves();
        assertApproxEqAbs(s, 1000 ether, 2);
        assertEq(m, 1_000_000 ether);
        assertSolvent();
    }

    function testSlippageRevertsAtomically() public {
        uint256 quote = market.quoteBuy(100 ether);
        vm.prank(alice);
        vm.expectRevert();
        market.buy(100 ether, quote + 1);
        assertEq(stock.balanceOf(alice), 10_000 ether);
        buyAs(alice, 100 ether);
        uint256 tokens = meme.balanceOf(alice);
        uint256 sellQuote = market.quoteSell(tokens);
        vm.startPrank(alice);
        meme.approve(address(market), tokens);
        vm.expectRevert();
        market.sell(tokens, sellQuote + 1);
        vm.stopPrank();
        assertEq(meme.balanceOf(alice), tokens);
    }

    function testInsufficientBalancesAndApproval() public {
        vm.prank(alice);
        vm.expectRevert();
        market.buy(10_001 ether, 0);
        vm.startPrank(alice);
        meme.approve(address(market), type(uint256).max);
        vm.expectRevert();
        market.sell(1 ether, 0);
        stock.approve(address(market), 0);
        vm.expectRevert();
        market.buy(1 ether, 0);
        vm.stopPrank();
    }

    function testInitializationAndCallbackRestricted() public {
        vm.prank(alice);
        vm.expectRevert();
        market.initialize(address(rewardVault), 1000 ether);
        vm.expectRevert();
        market.initialize(address(rewardVault), 1000 ether);
        vm.expectRevert();
        market.checkpoint(alice, bob);
        vm.expectRevert();
        meme.registerMarket(address(market));
    }

    function testZeroTradesAndQuotes() public {
        assertEq(market.quoteBuy(0), 0);
        assertEq(market.quoteSell(0), 0);
        vm.expectRevert();
        market.buy(0, 0);
        vm.expectRevert();
        market.sell(0, 0);
    }

    function testUninitializedMarketCannotTradeOrSettle() public {
        MemeMarket fresh = new MemeMarket(address(meme), address(stock), treasury, address(this));
        vm.expectRevert();
        fresh.buy(1 ether, 0);
        vm.expectRevert();
        fresh.sell(1 ether, 0);
        vm.expectRevert();
        fresh.settleEpoch();
        vm.expectRevert();
        fresh.claimHolderRewards();
        vm.expectRevert();
        fresh.initialize(address(rewardVault), 1 ether);
    }

    function testOnlyFactoryCanRegisterMarket() public {
        MemeToken fresh = new MemeToken("Fresh", "FRESH");
        vm.prank(alice);
        vm.expectRevert();
        fresh.registerMarket(address(market));
        vm.expectRevert();
        fresh.registerMarket(alice);
        fresh.registerMarket(address(market));
        vm.expectRevert();
        fresh.registerMarket(address(market));
    }

    function testTinyFeeRemainderGoesToTreasury() public {
        buyAs(alice, 100);
        assertEq(market.pendingHolderFees(), 0);
        assertEq(market.pendingVaultFees(), 0);
        assertEq(market.pendingTreasuryFees(), 1);
        settle();
        assertEq(stock.balanceOf(treasury), 1);
        assertSolvent();
    }

    function testDirectDonationsDoNotChangePricing() public {
        uint256 quote = market.quoteBuy(100 ether);
        stock.transfer(address(market), 1 ether);
        assertEq(market.quoteBuy(100 ether), quote);
        (uint256 s,) = market.getReserves();
        assertEq(s, 1000 ether);
    }

    function testFuzzRoundTripSolvency(uint96 input) public {
        uint256 amount = bound(uint256(input), 1 ether, 9000 ether);
        buyAs(alice, amount);
        uint256 tokens = meme.balanceOf(alice);
        vm.startPrank(alice);
        meme.approve(address(market), tokens);
        market.sell(tokens, 0);
        vm.stopPrank();
        settle();
        assertSolvent();
        assertLe(stock.balanceOf(alice), 10_000 ether);
        (uint256 s, uint256 m) = market.getReserves();
        assertGe(s * m, 1000 ether * 1_000_000 ether);
    }

    // Loads the REAL Factory artifact, and therefore the REAL Developer 2 Vault.
    // Run this after StockVault.sol is merged; no replacement production Vault is supplied.
    function testFactoryCreatesTokenAndMarket() public {
        ITradingFactory factory =
            ITradingFactory(deployCode("StockBackFactory.sol:StockBackFactory", abi.encode(address(stock), treasury)));
        vm.startPrank(alice);
        stock.approve(address(factory), 1000 ether);
        (address token, address pool, address vault_) = factory.createCoin("Cat", "CAT", 1000 ether);
        vm.stopPrank();
        assertEq(MemeToken(token).totalSupply(), 1_000_000 ether);
        assertEq(MemeToken(token).balanceOf(pool), 1_000_000 ether);
        assertEq(MemeMarket(pool).vault(), vault_);
        assertGt(vault_.code.length, 0);
        assertEq(stock.balanceOf(pool), 1000 ether);
        assertEq(factory.getMarkets()[0], pool);
        vm.prank(alice);
        stock.approve(pool, 100 ether);
        vm.prank(alice);
        MemeMarket(pool).buy(100 ether, 1);
        assertGt(MemeToken(token).balanceOf(alice), 0);
    }

    function testFactoryRejectsInvalidInputs() public {
        ITradingFactory factory =
            ITradingFactory(deployCode("StockBackFactory.sol:StockBackFactory", abi.encode(address(stock), treasury)));
        vm.expectRevert();
        factory.createCoin("", "CAT", 1000 ether);
        vm.expectRevert();
        factory.createCoin("Cat", "", 1000 ether);
        vm.expectRevert();
        factory.createCoin("Cat", "CAT", 0);
        vm.expectRevert();
        factory.createCoin("Cat", "CAT", 1000 ether);
        assertEq(factory.getMarkets().length, 0);
    }
}
