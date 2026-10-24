// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TradingFixture} from "./Trading.t.sol";

contract RewardsTest is TradingFixture {
    function testFortyTenFiftyAllocation() public {
        rewardVault.setWeight(1);
        buyAs(alice, 100 ether);
        settle();
        assertEq(stock.balanceOf(address(rewardVault)), 0.1 ether);
        assertEq(stock.balanceOf(treasury), 0.5 ether);
        assertApproxEqAbs(market.pendingHolderRewards(alice), 0.4 ether, 1);
        vm.prank(alice);
        market.claimHolderRewards();
        assertApproxEqAbs(stock.balanceOf(alice), 9900.4 ether, 1);
        assertSolvent();
    }

    function testMultipleHoldersAndTransferCheckpoint() public {
        buyAs(alice, 100 ether);
        settle();
        uint256 firstReward = market.pendingHolderRewards(alice);
        uint256 half = meme.balanceOf(alice) / 2;
        vm.prank(alice);
        meme.transfer(bob, half);
        assertEq(market.pendingHolderRewards(alice), firstReward);
        assertEq(market.pendingHolderRewards(bob), 0);
        buyAs(bob, 100 ether);
        settle();
        uint256 total = meme.balanceOf(alice) + meme.balanceOf(bob);
        uint256 expectedAlice = 0.4 ether * meme.balanceOf(alice) / total;
        uint256 expectedBob = 0.4 ether * meme.balanceOf(bob) / total;
        assertApproxEqAbs(market.pendingHolderRewards(alice), firstReward + expectedAlice, 2);
        assertApproxEqAbs(market.pendingHolderRewards(bob), expectedBob, 2);
    }

    function testNoDoubleClaim() public {
        buyAs(alice, 100 ether);
        settle();
        vm.startPrank(alice);
        market.claimHolderRewards();
        uint256 afterFirst = stock.balanceOf(alice);
        market.claimHolderRewards();
        vm.stopPrank();
        assertEq(stock.balanceOf(alice), afterFirst);
        assertEq(market.pendingHolderRewards(alice), 0);
    }

    function testNoEligibleHoldersRoutesEverythingToTreasury() public {
        buyAs(alice, 100 ether);
        uint256 tokens = meme.balanceOf(alice);
        vm.prank(alice);
        meme.transfer(address(market), tokens);
        settle();
        assertEq(stock.balanceOf(treasury), 1 ether);
        assertEq(market.pendingHolderRewards(alice), 0);
        assertEq(stock.balanceOf(address(rewardVault)), 0);
        assertSolvent();
    }

    function testZeroVaultStakersRoutesVaultShareToTreasury() public {
        buyAs(alice, 100 ether);
        settle();
        assertEq(stock.balanceOf(treasury), 0.6 ether);
        assertEq(stock.balanceOf(address(rewardVault)), 0);
        assertApproxEqAbs(market.pendingHolderRewards(alice), 0.4 ether, 1);
    }

    function testEpochBoundaryAndNoRepeatedSettlement() public {
        buyAs(alice, 100 ether);
        uint256 at = market.nextEpochAt();
        vm.warp(at - 1);
        vm.expectRevert();
        market.settleEpoch();
        vm.warp(at);
        market.settleEpoch();
        assertEq(market.nextEpochAt(), at + 300);
        vm.expectRevert();
        market.settleEpoch();
    }

    function testSettlementTimePositioningIsExplicitlyAllowed() public {
        buyAs(alice, 100 ether);
        vm.warp(market.nextEpochAt());
        uint256 tokens = meme.balanceOf(alice);
        vm.prank(alice);
        meme.transfer(bob, tokens);
        market.settleEpoch();
        assertEq(market.pendingHolderRewards(alice), 0);
        assertApproxEqAbs(market.pendingHolderRewards(bob), 0.4 ether, 1);
    }

    function testPastRewardsSurviveExitAndEmptySettlement() public {
        buyAs(alice, 100 ether);
        settle();
        uint256 earned = market.pendingHolderRewards(alice);
        vm.startPrank(alice);
        meme.approve(address(market), type(uint256).max);
        market.sell(meme.balanceOf(alice), 0);
        vm.stopPrank();
        settle();
        assertEq(market.pendingHolderRewards(alice), earned);
        uint256 beforeClaim = stock.balanceOf(alice);
        vm.prank(alice);
        market.claimHolderRewards();
        assertEq(stock.balanceOf(alice), beforeClaim + earned);
        assertSolvent();
    }

    function testFuzzTransfersClaimsAndReserveSolvency(uint96 input) public {
        buyAs(alice, bound(uint256(input), 1 ether, 4000 ether));
        settle();
        uint256 third = meme.balanceOf(alice) / 3;
        vm.prank(alice);
        meme.transfer(bob, third);
        buyAs(bob, 100 ether);
        settle();
        vm.prank(alice);
        market.claimHolderRewards();
        vm.prank(bob);
        market.claimHolderRewards();
        assertSolvent();
        (uint256 s,) = market.getReserves();
        assertLe(stock.balanceOf(address(market)) - s, 2);
    }

    function testVaultCallbackCannotReenterMarket() public {
        rewardVault.setWeight(1);
        rewardVault.enableReentry();
        buyAs(alice, 100 ether);
        settle();
        assertEq(stock.balanceOf(address(rewardVault)), 0.1 ether);
        assertEq(stock.balanceOf(treasury), 0.5 ether);
        assertApproxEqAbs(market.pendingHolderRewards(alice), 0.4 ether, 1);
        assertSolvent();
    }

    function testTransferFromAndSelfTransferKeepPastRewards() public {
        buyAs(alice, 100 ether);
        settle();
        uint256 earned = market.pendingHolderRewards(alice);
        uint256 tokens = meme.balanceOf(alice);
        vm.startPrank(alice);
        meme.transfer(alice, tokens);
        meme.approve(bob, tokens);
        vm.stopPrank();
        assertEq(market.pendingHolderRewards(alice), earned);
        vm.prank(bob);
        meme.transferFrom(alice, bob, tokens);
        assertEq(market.pendingHolderRewards(alice), earned);
        assertEq(market.pendingHolderRewards(bob), 0);
        vm.prank(alice);
        market.claimHolderRewards();
        assertEq(market.pendingHolderRewards(alice), 0);
        assertSolvent();
    }

    function testNewBuyerCannotClaimPreviouslySettledRewards() public {
        buyAs(alice, 100 ether);
        settle();
        buyAs(bob, 100 ether);
        assertEq(market.pendingHolderRewards(bob), 0);
        assertApproxEqAbs(market.pendingHolderRewards(alice), 0.4 ether, 1);
        settle();
        assertGt(market.pendingHolderRewards(bob), 0);
        assertEq(market.pendingHolderRewards(address(market)), 0);
        assertSolvent();
    }

    function testNoHoldersWithActiveVault() public {
        rewardVault.setWeight(1);
        buyAs(alice, 100 ether);
        uint256 tokens = meme.balanceOf(alice);
        vm.prank(alice);
        meme.transfer(address(market), tokens);
        settle();
        assertEq(stock.balanceOf(address(rewardVault)), 0.1 ether);
        assertEq(stock.balanceOf(treasury), 0.9 ether);
        assertSolvent();
    }

    function testMissedEpochsCoalesceAndEmptyEpochDoesNotPayTwice() public {
        buyAs(alice, 100 ether);
        vm.warp(market.nextEpochAt() + 900);
        market.settleEpoch();
        assertEq(market.nextEpochAt(), block.timestamp + 300);
        uint256 earned = market.pendingHolderRewards(alice);
        uint256 treasuryBalance = stock.balanceOf(treasury);
        settle();
        assertEq(market.pendingHolderRewards(alice), earned);
        assertEq(stock.balanceOf(treasury), treasuryBalance);
        assertSolvent();
    }
}
