// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {StockVault} from "../src/StockVault.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// Self-contained Foundry tests: no forge-std dependency is required.
interface VmVault {
    function prank(address sender) external;
    function warp(uint256 timestamp) external;
    function expectRevert(bytes4 selector) external;
    function expectRevert(bytes calldata revertData) external;
    function expectRevert() external;
}

contract VaultStockMock is ERC20 {
    constructor() ERC20("Mock SPYx", "SPYx") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract VaultMarketMock {
    VaultStockMock public immutable token;

    constructor(VaultStockMock token_) {
        token = token_;
    }

    function fund(StockVault vault, uint256 amount) external {
        require(vault.totalWeight() != 0, "no stakers");
        require(token.transfer(address(vault), amount), "reward transfer failed");
        vault.notifyReward(amount);
    }

    function notifyOnly(StockVault vault, uint256 amount) external {
        vault.notifyReward(amount);
    }
}

contract VaultAdversarialToken is ERC20 {
    StockVault private target;
    bytes private callback;
    bool public callbackSucceeded;
    bytes4 public callbackError;
    bool public taxed;
    bool public failTransfers;

    constructor() ERC20("Adversarial token", "BAD") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function configure(StockVault target_, bytes calldata callback_, bool taxed_, bool failTransfers_) external {
        target = target_;
        callback = callback_;
        taxed = taxed_;
        failTransfers = failTransfers_;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        if (failTransfers) return false;
        return super.transfer(to, amount);
    }

    function _update(address from, address to, uint256 amount) internal override {
        if (from != address(0) && to != address(0)) {
            if (callback.length != 0) {
                bytes memory data = callback;
                delete callback;
                bytes memory result;
                (callbackSucceeded, result) = address(target).call(data);
                // Deliberately retain only the four-byte revert selector.
                // forge-lint: disable-next-line(unsafe-typecast)
                if (result.length >= 4) callbackError = bytes4(result);
            }
            if (taxed && amount != 0) {
                super._update(from, address(0), 1);
                amount -= 1;
            }
        }
        super._update(from, to, amount);
    }
}

contract VaultTest {
    VmVault private constant vm = VmVault(address(uint160(uint256(keccak256("hevm cheat code")))));
    VaultStockMock private token;
    VaultMarketMock private market;
    StockVault private vault;
    address private constant ALICE = address(0xA11CE);
    address private constant BOB = address(0xB0B);

    function setUp() public {
        token = new VaultStockMock();
        market = new VaultMarketMock(token);
        vault = new StockVault(address(token), address(market));
        token.mint(ALICE, 10_000 ether);
        token.mint(BOB, 10_000 ether);
        token.mint(address(market), 10_000 ether);
        vm.prank(ALICE);
        token.approve(address(vault), type(uint256).max);
        vm.prank(BOB);
        token.approve(address(vault), type(uint256).max);
    }

    function _deposit(address user, uint256 amount, uint256 lockDays) private returns (uint256 id) {
        vm.prank(user);
        vault.deposit(amount, lockDays);
        StockVault.Position[] memory positions = vault.getPositions(user);
        return positions[positions.length - 1].id;
    }

    function _withdraw(address user, uint256 id) private {
        vm.prank(user);
        vault.withdraw(id);
    }

    function _eq(uint256 actual, uint256 expected) private pure {
        require(actual == expected, "unexpected amount");
    }

    function testDepositOrdinaryWalletTokens() public {
        uint256 started = block.timestamp;
        uint256 id = _deposit(ALICE, 100 ether, 30);
        StockVault.Position memory p = vault.getPositions(ALICE)[0];
        _eq(p.id, id);
        require(p.owner == ALICE && !p.withdrawn, "bad owner/state");
        _eq(p.amount, 100 ether);
        _eq(p.weightedAmount, 100 ether);
        _eq(p.startAt, started);
        _eq(p.unlockAt, started + 30 days);
        _eq(token.balanceOf(address(vault)), 100 ether);
        _eq(token.balanceOf(ALICE), 9_900 ether);
        _eq(vault.totalWeight(), 100 ether);
        _eq(vault.pendingRewards(id), 0);
    }

    function testRewardOriginDoesNotAffectDeposit() public {
        vm.prank(address(market));
        require(token.transfer(ALICE, 10 ether), "holder reward transfer failed");
        uint256 id = _deposit(ALICE, 10 ether, 30);
        vm.warp(block.timestamp + 30 days);
        _withdraw(ALICE, id);
        _eq(token.balanceOf(ALICE), 10_010 ether);
    }

    function testMultiplePositionsAndAllLockPeriods() public {
        uint256 started = block.timestamp;
        _deposit(ALICE, 100 ether, 30);
        vm.warp(started + 1 days);
        _deposit(ALICE, 100 ether, 90);
        _deposit(ALICE, 100 ether, 180);
        StockVault.Position[] memory p = vault.getPositions(ALICE);
        _eq(p.length, 3);
        require(p[0].id != p[1].id && p[1].id != p[2].id, "duplicate IDs");
        _eq(p[0].unlockAt, started + 30 days);
        _eq(p[1].unlockAt, started + 91 days);
        _eq(p[2].unlockAt, started + 181 days);
        _eq(p[1].weightedAmount, 125 ether);
        _eq(p[2].weightedAmount, 160 ether);
        _eq(vault.totalWeight(), 385 ether);
        _eq(vault.getPositions(BOB).length, 0);
    }

    function testZeroDepositReverts() public {
        vm.expectRevert(StockVault.ZeroAmount.selector);
        vm.prank(ALICE);
        vault.deposit(0, 30);
    }

    function testFuzzInvalidLockPeriodsRevert(uint256 lockDays) public {
        if (lockDays == 30 || lockDays == 90 || lockDays == 180) return;
        vm.expectRevert(StockVault.InvalidLockDuration.selector);
        vm.prank(ALICE);
        vault.deposit(1 ether, lockDays);
    }

    function testMissingApprovalRevertsWithoutPosition() public {
        vm.prank(ALICE);
        token.approve(address(vault), 0);
        vm.expectRevert();
        vm.prank(ALICE);
        vault.deposit(1 ether, 30);
        _eq(vault.getPositions(ALICE).length, 0);
        _eq(vault.totalWeight(), 0);
    }

    function testEarlyWithdrawalRevertsAtLastLockedSecond() public {
        uint256 id = _deposit(ALICE, 100 ether, 30);
        vm.warp(block.timestamp + 30 days - 1);
        vm.expectRevert(StockVault.PositionLocked.selector);
        _withdraw(ALICE, id);
        _eq(token.balanceOf(address(vault)), 100 ether);
    }

    function testWithdrawAtExactExpiryWithoutRewards() public {
        uint256 id = _deposit(ALICE, 100 ether, 90);
        vm.warp(block.timestamp + 90 days);
        _withdraw(ALICE, id);
        _eq(token.balanceOf(ALICE), 10_000 ether);
        _eq(vault.totalWeight(), 0);
        _eq(vault.pendingRewards(id), 0);
        require(vault.getPositions(ALICE)[0].withdrawn, "position still active");
    }

    function testNonOwnerWithdrawalReverts() public {
        uint256 id = _deposit(ALICE, 100 ether, 30);
        vm.warp(block.timestamp + 30 days);
        vm.expectRevert(StockVault.NotPositionOwner.selector);
        _withdraw(BOB, id);
    }

    function testDoubleWithdrawalReverts() public {
        uint256 id = _deposit(ALICE, 100 ether, 30);
        market.fund(vault, 10 ether);
        vm.warp(block.timestamp + 30 days);
        _withdraw(ALICE, id);
        vm.expectRevert(StockVault.AlreadyWithdrawn.selector);
        _withdraw(ALICE, id);
        _eq(token.balanceOf(ALICE), 10_010 ether);
    }

    function testUnknownPositionReverts() public {
        vm.expectRevert(StockVault.InvalidPosition.selector);
        vault.pendingRewards(999);
        vm.expectRevert(StockVault.InvalidPosition.selector);
        vault.withdraw(999);
    }

    function testDifferentWeightsAllocateOnlyRewards() public {
        uint256 a = _deposit(ALICE, 100 ether, 30);
        uint256 b = _deposit(ALICE, 100 ether, 90);
        uint256 c = _deposit(BOB, 100 ether, 180);
        market.fund(vault, 385 ether);
        _eq(vault.pendingRewards(a), 100 ether);
        _eq(vault.pendingRewards(b), 125 ether);
        _eq(vault.pendingRewards(c), 160 ether);
        vm.warp(block.timestamp + 180 days);
        _withdraw(ALICE, a);
        _withdraw(ALICE, b);
        _withdraw(BOB, c);
        _eq(token.balanceOf(ALICE), 10_225 ether);
        _eq(token.balanceOf(BOB), 10_160 ether);
        _eq(token.balanceOf(address(vault)), 0);
    }

    function testNewDepositsCannotClaimOldRewards() public {
        uint256 a = _deposit(ALICE, 100 ether, 30);
        market.fund(vault, 20 ether);
        uint256 b = _deposit(BOB, 100 ether, 30);
        _eq(vault.pendingRewards(b), 0);
        market.fund(vault, 10 ether);
        _eq(vault.pendingRewards(a), 25 ether);
        _eq(vault.pendingRewards(b), 5 ether);
    }

    function testTwoUsersAndRewardsAfterOneWithdraws() public {
        uint256 a = _deposit(ALICE, 100 ether, 30);
        uint256 b = _deposit(BOB, 300 ether, 30);
        market.fund(vault, 40 ether);
        _eq(vault.pendingRewards(a), 10 ether);
        _eq(vault.pendingRewards(b), 30 ether);
        vm.warp(block.timestamp + 30 days);
        _withdraw(ALICE, a);
        market.fund(vault, 9 ether);
        _eq(vault.pendingRewards(b), 39 ether);
        _withdraw(BOB, b);
        _eq(token.balanceOf(ALICE), 10_010 ether);
        _eq(token.balanceOf(BOB), 10_039 ether);
    }

    function testPositionKeepsEarningAfterUnlock() public {
        uint256 id = _deposit(ALICE, 100 ether, 30);
        vm.warp(block.timestamp + 31 days);
        market.fund(vault, 10 ether);
        _eq(vault.pendingRewards(id), 10 ether);
        _eq(vault.getPositions(ALICE)[0].unlockAt, block.timestamp - 1 days);
        _withdraw(ALICE, id);
        _eq(token.balanceOf(ALICE), 10_010 ether);
    }

    function testUnauthorizedRewardNotificationRevertsEvenWhenFunded() public {
        _deposit(ALICE, 100 ether, 30);
        token.mint(address(vault), 10 ether);
        vm.expectRevert(StockVault.OnlyMarket.selector);
        vm.prank(ALICE);
        vault.notifyReward(10 ether);
    }

    function testUnderfundedNotificationCannotSpendPrincipal() public {
        uint256 id = _deposit(ALICE, 100 ether, 30);
        vm.expectRevert(StockVault.UnbackedReward.selector);
        market.notifyOnly(vault, 1 ether);
        token.mint(address(vault), 1 ether);
        vm.expectRevert(StockVault.UnbackedReward.selector);
        market.notifyOnly(vault, 2 ether);
        _eq(vault.pendingRewards(id), 0);
        _eq(token.balanceOf(address(vault)), 101 ether);
    }

    function testNoDoubleRewardDistribution() public {
        uint256 id = _deposit(ALICE, 100 ether, 30);
        market.fund(vault, 10 ether);
        vm.expectRevert(StockVault.UnbackedReward.selector);
        market.notifyOnly(vault, 10 ether);
        _eq(vault.pendingRewards(id), 10 ether);
        vm.warp(block.timestamp + 30 days);
        _withdraw(ALICE, id);
        _eq(token.balanceOf(address(vault)), 0);
    }

    function testNoActivePositionsRejectNotifications() public {
        _eq(vault.totalWeight(), 0);
        token.mint(address(vault), 10 ether);
        vm.expectRevert(StockVault.NoActivePositions.selector);
        market.notifyOnly(vault, 10 ether);
        uint256 id = _deposit(ALICE, 100 ether, 30);
        _eq(vault.pendingRewards(id), 0);
    }

    function testZeroRewardNotificationWithActivePosition() public {
        uint256 id = _deposit(ALICE, 100 ether, 30);
        market.notifyOnly(vault, 0);
        _eq(vault.pendingRewards(id), 0);
    }

    function testRoundingDoesNotGiveNewDepositsHistoricalFractions() public {
        uint256 a = _deposit(ALICE, 3, 30);
        market.fund(vault, 1);
        uint256 b = _deposit(BOB, 3, 30);
        market.fund(vault, 1);
        // Bob earned half a base unit, not a rounded historical fraction.
        _eq(vault.pendingRewards(a), 1);
        _eq(vault.pendingRewards(b), 0);
        vm.warp(block.timestamp + 30 days);
        _withdraw(ALICE, a);
        _withdraw(BOB, b);
        _eq(token.balanceOf(address(vault)), 1);
        uint256 c = _deposit(BOB, 3, 30);
        vm.expectRevert(StockVault.UnbackedReward.selector);
        market.notifyOnly(vault, 1);
        _eq(vault.pendingRewards(c), 0);
    }

    function testFuzzPrincipalAndRewardSolvency(uint96 x, uint96 y, uint96 fees) public {
        uint256 aAmount = uint256(x) % 1_000 ether + 1;
        uint256 bAmount = uint256(y) % 1_000 ether + 1;
        uint256 reward = uint256(fees) % 1_000 ether;
        uint256 a = _deposit(ALICE, aAmount, 90);
        uint256 b = _deposit(BOB, bAmount, 180);
        market.fund(vault, reward);
        uint256 ra = vault.pendingRewards(a);
        uint256 rb = vault.pendingRewards(b);
        require(ra + rb <= reward, "overallocated fees");
        vm.warp(block.timestamp + 180 days);
        _withdraw(ALICE, a);
        require(token.balanceOf(address(vault)) >= bAmount + rb, "principal insolvent");
        _withdraw(BOB, b);
        _eq(token.balanceOf(ALICE), 10_000 ether + ra);
        _eq(token.balanceOf(BOB), 10_000 ether + rb);
        _eq(token.balanceOf(address(vault)), reward - ra - rb);
        _eq(vault.totalWeight(), 0);
    }

    function testConstructorRejectsInvalidRelationships() public {
        vm.expectRevert(StockVault.InvalidAddress.selector);
        new StockVault(address(0), address(market));
        vm.expectRevert(StockVault.InvalidAddress.selector);
        new StockVault(ALICE, address(market));
        vm.expectRevert(StockVault.InvalidAddress.selector);
        new StockVault(address(token), address(0));
    }

    function testFeeOnTransferDepositRevertsWithoutCreatingUnbackedPrincipal() public {
        VaultAdversarialToken bad = new VaultAdversarialToken();
        StockVault other = new StockVault(address(bad), address(market));
        bad.mint(address(this), 100);
        bad.approve(address(other), 100);
        bad.configure(other, "", true, false);
        vm.expectRevert(StockVault.UnsupportedTokenTransfer.selector);
        other.deposit(100, 30);
        _eq(other.totalPrincipal(), 0);
        _eq(other.totalWeight(), 0);
        _eq(other.getPositions(address(this)).length, 0);
        _eq(bad.balanceOf(address(this)), 100);
    }

    function testReentrancyBlockedOnDepositWithdrawalAndNotification() public {
        VaultAdversarialToken bad = new VaultAdversarialToken();
        // Authorize the token as market so callback notification would pass access control.
        StockVault other = new StockVault(address(bad), address(bad));
        bad.mint(address(this), 300);
        bad.approve(address(other), 300);

        bad.configure(other, abi.encodeCall(StockVault.deposit, (1, 30)), false, false);
        other.deposit(100, 30);
        require(!bad.callbackSucceeded(), "deposit reentered");
        require(bad.callbackError() == bytes4(keccak256("ReentrancyGuardReentrantCall()")), "wrong guard error");

        bad.configure(other, abi.encodeCall(StockVault.notifyReward, (0)), false, false);
        other.deposit(100, 30);
        require(!bad.callbackSucceeded(), "notification reentered");
        require(bad.callbackError() == bytes4(keccak256("ReentrancyGuardReentrantCall()")), "wrong guard error");

        bad.configure(other, abi.encodeCall(StockVault.withdraw, (0)), false, false);
        vm.warp(block.timestamp + 30 days);
        other.withdraw(0);
        require(!bad.callbackSucceeded(), "withdrawal reentered");
        require(bad.callbackError() == bytes4(keccak256("ReentrancyGuardReentrantCall()")), "wrong guard error");
        other.withdraw(1);
        _eq(bad.balanceOf(address(this)), 300);
        _eq(other.totalPrincipal(), 0);
    }

    function testPayoutFailureRollsBackWithdrawal() public {
        VaultAdversarialToken bad = new VaultAdversarialToken();
        StockVault other = new StockVault(address(bad), address(market));
        bad.mint(address(this), 100);
        bad.approve(address(other), 100);
        other.deposit(100, 30);
        vm.warp(block.timestamp + 30 days);
        bad.configure(other, "", false, true);
        vm.expectRevert(abi.encodeWithSignature("SafeERC20FailedOperation(address)", address(bad)));
        other.withdraw(0);
        require(!other.getPositions(address(this))[0].withdrawn, "failed payout burned position");
        _eq(other.totalPrincipal(), 100);
        _eq(other.totalWeight(), 100);
        bad.configure(other, "", false, false);
        other.withdraw(0);
        _eq(bad.balanceOf(address(this)), 100);
    }

    function testFuzzSolvencyAcrossEntryExitAndRewardEpochs(uint96 x, uint96 y, uint96 fees) public {
        uint256 aAmount = uint256(x) % 1_000 ether + 1;
        uint256 bAmount = uint256(y) % 1_000 ether + 1;
        uint256 reward = uint256(fees) % 1_000 ether;
        uint256 a = _deposit(ALICE, aAmount, 90);
        market.fund(vault, reward);
        uint256 b = _deposit(BOB, bAmount, 180);
        _eq(vault.pendingRewards(b), 0);
        market.fund(vault, reward);
        vm.warp(block.timestamp + 180 days);
        _withdraw(ALICE, a);
        require(token.balanceOf(address(vault)) >= bAmount + vault.pendingRewards(b), "insolvent after exit");
        uint256 c = _deposit(ALICE, aAmount, 30);
        _eq(vault.pendingRewards(c), 0);
        market.fund(vault, reward);
        vm.warp(block.timestamp + 30 days);
        _withdraw(BOB, b);
        market.fund(vault, reward);
        _withdraw(ALICE, c);
        uint256 payouts = token.balanceOf(ALICE) + token.balanceOf(BOB) - 20_000 ether;
        require(payouts <= reward * 4, "excess reward payouts");
        _eq(token.balanceOf(address(vault)), reward * 4 - payouts);
        _eq(vault.totalPrincipal(), 0);
        _eq(vault.totalWeight(), 0);
        _eq(vault.rewardReserve(), reward * 4 - payouts);
    }
}
