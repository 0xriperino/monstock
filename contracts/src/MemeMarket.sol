// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @dev Agreed Developer 2 integration boundary. Stock is transferred before notifyReward.
interface IStockVaultRewards {
    function totalWeight() external view returns (uint256);
    function notifyReward(uint256 amount) external;
}

/// @notice Locked-liquidity AMM against test-only MockSPYx.
/// @dev Rewards use balances AT SETTLEMENT, not time-weighted ownership.
/// Last-minute positioning is possible and is an explicit hackathon MVP limitation.
contract MemeMarket is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant EPOCH_DURATION = 300;
    uint256 private constant PRECISION = 1e36;
    IERC20 public immutable memeToken;
    IERC20 public immutable stockToken;
    address public immutable treasury;
    address public immutable factory;
    address public vault;
    uint256 public nextEpochAt;
    uint256 internal _stockReserve;
    uint256 internal _memeReserve;

    uint256 public tradingFeeBps = 100;
    uint256 public pendingHolderFees;
    uint256 public pendingVaultFees;
    uint256 public pendingTreasuryFees;
    uint256 public rewardPerToken;
    // Includes sub-wei distribution dust; never available to AMM pricing.
    uint256 public holderRewardLiability;
    mapping(address => uint256) private paidRewardPerToken;
    mapping(address => uint256) private accruedRewards;
    mapping(address => uint256) private fractionalRewards;

    event Swap(address indexed trader, bool isBuy, uint256 amountIn, uint256 amountOut, uint256 stockFee);
    event EpochSettled(uint256 holderRewards, uint256 vaultRewards, uint256 treasuryRewards, uint256 nextEpochAt);
    event HolderRewardClaimed(address indexed holder, uint256 amount);

    constructor(address memeToken_, address stockToken_, address treasury_, address factory_) {
        require(memeToken_.code.length != 0 && stockToken_.code.length != 0, "Invalid token");
        require(memeToken_ != stockToken_ && treasury_ != address(0) && factory_ != address(0), "Invalid address");
        memeToken = IERC20(memeToken_);
        stockToken = IERC20(stockToken_);
        treasury = treasury_;
        factory = factory_;
    }

    modifier initialized() {
        require(vault != address(0), "Not initialized");
        _;
    }

    function initialize(address vault_, uint256 stockLiquidity) external virtual {
        require(msg.sender == factory, "Factory only");
        require(vault == address(0), "Already initialized");
        require(vault_.code.length != 0 && stockLiquidity != 0, "Invalid liquidity or vault");
        uint256 inventory = memeToken.balanceOf(address(this));
        require(inventory == memeToken.totalSupply() && inventory != 0, "Missing meme supply");
        require(stockToken.balanceOf(address(this)) >= stockLiquidity, "Missing stock liquidity");
        vault = vault_;
        _stockReserve = stockLiquidity;
        _memeReserve = inventory;
        nextEpochAt = block.timestamp + EPOCH_DURATION;
    }

    function getReserves() external view returns (uint256 stockReserve, uint256 memeReserve) {
        return (_stockReserve, _memeReserve);
    }

    function quoteBuy(uint256 stockIn) public view virtual initialized returns (uint256) {
        uint256 net = stockIn - Math.mulDiv(stockIn, tradingFeeBps, 10_000);
        return Math.mulDiv(_memeReserve, net, _stockReserve + net);
    }

    function quoteSell(uint256 memeIn) public view virtual initialized returns (uint256) {
        uint256 gross = _grossSell(memeIn);
        return gross - Math.mulDiv(gross, tradingFeeBps, 10_000);
    }

    function buy(uint256 stockIn, uint256 minMemeOut) external nonReentrant initialized {
        require(stockIn != 0, "Zero input");
        uint256 amountOut = quoteBuy(stockIn);
        require(amountOut != 0 && amountOut >= minMemeOut, "Slippage or zero output");
        uint256 fee = Math.mulDiv(stockIn, tradingFeeBps, 10_000);
        _stockReserve += stockIn - fee;
        _memeReserve -= amountOut;
        _collectFee(fee);
        stockToken.safeTransferFrom(msg.sender, address(this), stockIn);
        memeToken.safeTransfer(msg.sender, amountOut);
        emit Swap(msg.sender, true, stockIn, amountOut, fee);
    }

    function sell(uint256 memeIn, uint256 minStockOut) external nonReentrant initialized {
        require(memeIn != 0, "Zero input");
        uint256 gross = _grossSell(memeIn);
        uint256 fee = Math.mulDiv(gross, tradingFeeBps, 10_000);
        uint256 amountOut = gross - fee;
        require(amountOut != 0 && amountOut >= minStockOut, "Slippage or zero output");
        _memeReserve += memeIn;
        _stockReserve -= gross;
        _collectFee(fee);
        memeToken.safeTransferFrom(msg.sender, address(this), memeIn);
        stockToken.safeTransfer(msg.sender, amountOut);
        emit Swap(msg.sender, false, memeIn, amountOut, fee);
    }

    function _grossSell(uint256 memeIn) internal view virtual returns (uint256) {
        return Math.mulDiv(_stockReserve, memeIn, _memeReserve + memeIn);
    }

    /// @dev Per-trade allocation floors holder/vault shares; remaining wei go to treasury.
    function _collectFee(uint256 fee) private {
        uint256 holderPart = Math.mulDiv(fee, 40, 100);
        uint256 vaultPart = fee / 10;
        pendingHolderFees += holderPart;
        pendingVaultFees += vaultPart;
        pendingTreasuryFees += fee - holderPart - vaultPart;
    }

    /// @notice Settle all fees accumulated since the last settlement, once 300s have elapsed.
    /// @dev Missed epochs are coalesced. Next settlement is 300s after this call.
    function settleEpoch() external nonReentrant initialized {
        require(block.timestamp >= nextEpochAt, "Epoch not ready");
        uint256 holders = pendingHolderFees;
        uint256 vaultRewards = pendingVaultFees;
        uint256 treasuryRewards = pendingTreasuryFees;
        pendingHolderFees = 0;
        pendingVaultFees = 0;
        pendingTreasuryFees = 0;
        nextEpochAt = block.timestamp + EPOCH_DURATION;

        uint256 eligibleSupply = memeToken.totalSupply() - memeToken.balanceOf(address(this));
        if (eligibleSupply == 0) {
            treasuryRewards += holders;
            holders = 0;
        } else {
            rewardPerToken += Math.mulDiv(holders, PRECISION, eligibleSupply);
            holderRewardLiability += holders;
        }

        if (vaultRewards != 0) {
            if (IStockVaultRewards(vault).totalWeight() == 0) {
                treasuryRewards += vaultRewards;
                vaultRewards = 0;
            } else {
                stockToken.safeTransfer(vault, vaultRewards);
                IStockVaultRewards(vault).notifyReward(vaultRewards);
            }
        }
        if (treasuryRewards != 0) stockToken.safeTransfer(treasury, treasuryRewards);
        emit EpochSettled(holders, vaultRewards, treasuryRewards, nextEpochAt);
    }

    /// @notice Called only by the associated MemeToken, BEFORE balances change.
    /// @dev Must permit the token callback during guarded buy/sell entry points.
    function checkpoint(address from, address to) external {
        require(msg.sender == address(memeToken), "MemeToken only");
        _checkpoint(from);
        if (to != from) _checkpoint(to);
    }

    function _checkpoint(address user) private {
        if (user == address(0) || user == address(this)) return;
        (uint256 whole, uint256 fraction) = _unaccounted(user);
        accruedRewards[user] += whole;
        fractionalRewards[user] = fraction;
        paidRewardPerToken[user] = rewardPerToken;
    }

    function _unaccounted(address user) private view returns (uint256 whole, uint256 fraction) {
        uint256 balance = memeToken.balanceOf(user);
        uint256 delta = rewardPerToken - paidRewardPerToken[user];
        whole = Math.mulDiv(balance, delta, PRECISION);
        fraction = mulmod(balance, delta, PRECISION) + fractionalRewards[user];
        whole += fraction / PRECISION;
        fraction %= PRECISION;
    }

    function pendingHolderRewards(address user) external view returns (uint256) {
        if (user == address(0) || user == address(this)) return 0;
        (uint256 whole,) = _unaccounted(user);
        return accruedRewards[user] + whole;
    }

    function claimHolderRewards() external nonReentrant initialized {
        _checkpoint(msg.sender);
        uint256 amount = accruedRewards[msg.sender];
        if (amount == 0) return;
        accruedRewards[msg.sender] = 0;
        holderRewardLiability -= amount;
        stockToken.safeTransfer(msg.sender, amount);
        emit HolderRewardClaimed(msg.sender, amount);
    }
}
