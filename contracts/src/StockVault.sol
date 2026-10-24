// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Time-locked MockSPYx principal with variable, market-funded fee rewards.
/// @dev Intended for a standard, non-rebasing, non-fee-on-transfer ERC20.
contract StockVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant PRECISION = 1e27;
    uint256 private constant BPS = 10_000;

    struct Position {
        uint256 id;
        address owner;
        uint256 amount;
        uint256 weightedAmount;
        uint256 startAt;
        uint256 unlockAt;
        // Scaled reward-per-weight snapshot at deposit, NOT a rounded token amount.
        // Subtracting before mulDiv prevents newcomers inheriting historical fractions.
        uint256 rewardDebt;
        bool withdrawn;
    }

    IERC20 public immutable stockToken;
    address public immutable market;
    uint256 public totalWeight;
    uint256 public totalPrincipal;
    /// @notice All notified rewards less payouts, including reserved rounding dust.
    uint256 public rewardReserve;
    uint256 public accRewardPerWeight;

    Position[] private _positions;
    mapping(address => uint256[]) private _userPositionIds;

    error ZeroAmount();
    error InvalidLockDuration();
    error PositionLocked();
    error NotPositionOwner();
    error AlreadyWithdrawn();
    error InvalidPosition();
    error OnlyMarket();
    error UnbackedReward();
    error NoActivePositions();
    error InvalidAddress();
    error UnsupportedTokenTransfer();

    event Deposited(
        address indexed owner, uint256 indexed positionId, uint256 amount, uint256 weightedAmount, uint256 unlockAt
    );
    event Withdrawn(address indexed owner, uint256 indexed positionId, uint256 principal, uint256 rewards);
    event RewardNotified(uint256 amount);

    constructor(address stockToken_, address market_) {
        if (stockToken_.code.length == 0 || market_ == address(0)) revert InvalidAddress();
        stockToken = IERC20(stockToken_);
        market = market_;
    }

    /// @notice Deposit wallet tokens or previously earned tokens through the same path.
    /// @dev Position IDs are global and zero-based. Unlock timestamps and weights never change.
    function deposit(uint256 amount, uint256 lockDays) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 multiplier;
        if (lockDays == 30) multiplier = 10_000;
        else if (lockDays == 90) multiplier = 12_500;
        else if (lockDays == 180) multiplier = 16_000;
        else revert InvalidLockDuration();

        uint256 balanceBefore = stockToken.balanceOf(address(this));
        stockToken.safeTransferFrom(msg.sender, address(this), amount);
        if (stockToken.balanceOf(address(this)) != balanceBefore + amount) revert UnsupportedTokenTransfer();

        uint256 weightedAmount = Math.mulDiv(amount, multiplier, BPS);
        uint256 id = _positions.length;
        uint256 unlockAt = block.timestamp + lockDays * 1 days;
        _positions.push(
            Position({
                id: id,
                owner: msg.sender,
                amount: amount,
                weightedAmount: weightedAmount,
                startAt: block.timestamp,
                unlockAt: unlockAt,
                rewardDebt: accRewardPerWeight,
                withdrawn: false
            })
        );
        _userPositionIds[msg.sender].push(id);
        totalPrincipal += amount;
        totalWeight += weightedAmount;
        emit Deposited(msg.sender, id, amount, weightedAmount, unlockAt);
    }

    /// @notice Return principal and all accrued rewards at or after the immutable unlock time.
    function withdraw(uint256 positionId) external nonReentrant {
        if (positionId >= _positions.length) revert InvalidPosition();
        Position storage p = _positions[positionId];
        if (p.owner != msg.sender) revert NotPositionOwner();
        if (p.withdrawn) revert AlreadyWithdrawn();
        if (block.timestamp < p.unlockAt) revert PositionLocked();

        uint256 rewards = pendingRewards(positionId);
        p.withdrawn = true;
        totalWeight -= p.weightedAmount;
        totalPrincipal -= p.amount;
        rewardReserve -= rewards;
        stockToken.safeTransfer(msg.sender, p.amount + rewards);
        emit Withdrawn(msg.sender, positionId, p.amount, rewards);
    }

    function pendingRewards(uint256 positionId) public view returns (uint256) {
        if (positionId >= _positions.length) revert InvalidPosition();
        Position storage p = _positions[positionId];
        if (p.withdrawn) return 0;
        return Math.mulDiv(p.weightedAmount, accRewardPerWeight - p.rewardDebt, PRECISION);
    }

    /// @notice All of a user's positions in deposit order, including withdrawn positions.
    function getPositions(address user) external view returns (Position[] memory positions) {
        uint256[] storage ids = _userPositionIds[user];
        positions = new Position[](ids.length);
        for (uint256 i; i < ids.length; ++i) {
            positions[i] = _positions[ids[i]];
        }
    }

    /// @notice Account for fee tokens already transferred by the associated MemeMarket.
    /// @dev Market must skip both transfer and notification if totalWeight is zero.
    ///      Distribution is O(1). Rounding always favors solvency; dust stays reserved
    ///      and is never recycled into later deposits or notified a second time.
    function notifyReward(uint256 amount) external nonReentrant {
        if (msg.sender != market) revert OnlyMarket();
        if (totalWeight == 0) revert NoActivePositions();
        uint256 accounted = totalPrincipal + rewardReserve;
        uint256 balance = stockToken.balanceOf(address(this));
        if (balance < accounted || amount > balance - accounted) revert UnbackedReward();

        rewardReserve += amount;
        accRewardPerWeight += Math.mulDiv(amount, PRECISION, totalWeight);
        emit RewardNotified(amount);
    }
}
