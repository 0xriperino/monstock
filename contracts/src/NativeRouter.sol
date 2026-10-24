// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {BondingCurveLauncher} from "./BondingCurveLauncher.sol";
import {MemeMarket} from "./MemeMarket.sol";

interface IMarketRegistry {
    function getMarkets() external view returns (address[] memory);
}

interface ILaunchRegistry {
    function getMarkets(address quote) external view returns (address[] memory);
}

interface ICurvePricing {
    function getPricingReserves() external view returns (uint256, uint256);
}

interface ITestQuote {
    function hasClaimed(address user) external view returns (bool);
    function faucet() external;
}

/// @notice Monad TESTNET converter and atomic trade router, using finite faucet reserves.
/// The fixed demo rate is NOT a real MON, dollar, stock or security market price.
/// No admin withdrawals: native balances remain available for reverse conversions.
contract NativeRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;
    uint256 public constant QUOTE_PER_MON = 1000;
    BondingCurveLauncher public immutable launcher;
    address[] public legacyLaunchers;
    mapping(address => address) public creatorOf;

    event NativeTrade(
        address indexed user,
        address indexed market,
        bool buy,
        uint256 nativeAmount,
        uint256 quoteAmount,
        uint256 memeAmount
    );
    event NativeLaunch(address indexed token, address indexed market, address indexed creator, uint256 nativeCost);

    constructor(address launcher_, address[] memory previousLaunchers) {
        require(launcher_.code.length != 0, "Invalid launcher");
        launcher = BondingCurveLauncher(launcher_);
        for (uint256 i; i < previousLaunchers.length; ++i) {
            require(previousLaunchers[i].code.length != 0, "Invalid registry");
            legacyLaunchers.push(previousLaunchers[i]);
        }
    }

    receive() external payable {}

    function seedQuote(address quote) external nonReentrant {
        require(launcher.factoryFor(quote) != address(0), "Unsupported quote asset");
        if (!ITestQuote(quote).hasClaimed(address(this))) ITestQuote(quote).faucet();
    }

    function _contains(address[] memory markets, address market) private pure returns (bool) {
        for (uint256 i; i < markets.length; ++i) {
            if (markets[i] == market) return true;
        }
        return false;
    }

    function _market(address market) private view returns (IERC20 quote, IERC20 meme) {
        quote = MemeMarket(market).stockToken();
        address factory = launcher.factoryFor(address(quote));
        require(factory != address(0), "Unsupported quote asset");
        bool registered = _contains(IMarketRegistry(factory).getMarkets(), market)
            || _contains(launcher.getMarkets(address(quote)), market);
        for (uint256 i; !registered && i < legacyLaunchers.length; ++i) {
            registered = _contains(ILaunchRegistry(legacyLaunchers[i]).getMarkets(address(quote)), market);
        }
        require(registered, "Unregistered market");
        meme = MemeMarket(market).memeToken();
    }

    function _checkDeadline(uint256 deadline) private view {
        require(block.timestamp <= deadline, "Quote expired");
    }

    function nativeCost(uint256 quoteAmount) public pure returns (uint256) {
        return Math.ceilDiv(quoteAmount, QUOTE_PER_MON);
    }

    function quoteBuyMON(address market, uint256 monIn) external view returns (uint256 memeOut, uint256 quoteIn) {
        (IERC20 quote,) = _market(market);
        quoteIn = monIn * QUOTE_PER_MON;
        require(quote.balanceOf(address(this)) >= quoteIn, "Conversion quote reserve unavailable");
        memeOut = MemeMarket(market).quoteBuy(quoteIn);
    }

    function _exactQuote(address market, uint256 memeOut) private view returns (uint256 quoteIn) {
        uint256 reserve;
        uint256 inventory;
        try ICurvePricing(market).getPricingReserves() returns (uint256 r, uint256 m) {
            reserve = r;
            inventory = m;
        } catch {
            (reserve, inventory) = MemeMarket(market).getReserves();
        }
        require(memeOut != 0 && memeOut < inventory, "Token amount exceeds inventory");
        uint256 net = Math.mulDiv(reserve, memeOut, inventory - memeOut, Math.Rounding.Ceil);
        uint256 fee = 100;
        try MemeMarket(market).tradingFeeBps() returns (uint256 value) {
            fee = value;
        } catch {}
        require(fee == 100 || fee == 300, "Unsupported trading fee");
        // net(q) = ceil(q * (10000-fee) / 10000); choose the smallest q meeting net.
        quoteIn = Math.mulDiv(net - 1, 10_000, 10_000 - fee) + 1;
    }

    function quoteBuyTokens(address market, uint256 wanted)
        external
        view
        returns (uint256 monIn, uint256 quoteIn, uint256 memeOut)
    {
        (IERC20 quote,) = _market(market);
        quoteIn = _exactQuote(market, wanted);
        require(quote.balanceOf(address(this)) >= quoteIn, "Conversion quote reserve unavailable");
        monIn = nativeCost(quoteIn);
        memeOut = MemeMarket(market).quoteBuy(quoteIn);
    }

    function quoteSellMON(address market, uint256 memeIn) external view returns (uint256 monOut, uint256 quoteOut) {
        _market(market);
        quoteOut = MemeMarket(market).quoteSell(memeIn);
        monOut = quoteOut / QUOTE_PER_MON;
        require(address(this).balance >= monOut, "Conversion MON reserve unavailable");
    }

    function _buy(address market, IERC20 quote, IERC20 meme, uint256 quoteIn, uint256 minimum, address recipient)
        private
        returns (uint256 output)
    {
        require(quoteIn != 0 && quote.balanceOf(address(this)) >= quoteIn, "Conversion quote reserve unavailable");
        uint256 before = meme.balanceOf(address(this));
        quote.forceApprove(market, quoteIn);
        MemeMarket(market).buy(quoteIn, minimum);
        output = meme.balanceOf(address(this)) - before;
        meme.safeTransfer(recipient, output);
    }

    function buyMON(address market, uint256 minimum, uint256 deadline)
        external
        payable
        nonReentrant
        returns (uint256 output)
    {
        _checkDeadline(deadline);
        (IERC20 quote, IERC20 meme) = _market(market);
        uint256 quoteIn = msg.value * QUOTE_PER_MON;
        output = _buy(market, quote, meme, quoteIn, minimum, msg.sender);
        emit NativeTrade(msg.sender, market, true, msg.value, quoteIn, output);
    }

    function buyTokens(address market, uint256 wanted, uint256 deadline)
        external
        payable
        nonReentrant
        returns (uint256 spent, uint256 output)
    {
        _checkDeadline(deadline);
        (IERC20 quote, IERC20 meme) = _market(market);
        uint256 quoteIn = _exactQuote(market, wanted);
        spent = nativeCost(quoteIn);
        require(msg.value >= spent, "MON cost exceeds maximum");
        output = _buy(market, quote, meme, quoteIn, wanted, msg.sender);
        _pay(msg.sender, msg.value - spent);
        emit NativeTrade(msg.sender, market, true, spent, quoteIn, output);
    }

    function sellMON(address market, uint256 memeIn, uint256 minimumMON, uint256 deadline)
        external
        nonReentrant
        returns (uint256 monOut)
    {
        _checkDeadline(deadline);
        (IERC20 quote, IERC20 meme) = _market(market);
        uint256 before = quote.balanceOf(address(this));
        meme.safeTransferFrom(msg.sender, address(this), memeIn);
        meme.forceApprove(market, memeIn);
        MemeMarket(market).sell(memeIn, minimumMON * QUOTE_PER_MON);
        uint256 received = quote.balanceOf(address(this)) - before;
        monOut = received / QUOTE_PER_MON;
        require(monOut != 0 && monOut >= minimumMON, "Insufficient MON output");
        _pay(msg.sender, monOut);
        emit NativeTrade(msg.sender, market, false, monOut, received, memeIn);
    }

    function launchMON(BondingCurveLauncher.LaunchParams calldata p, uint256 deadline)
        external
        payable
        nonReentrant
        returns (address token, address market, address vault)
    {
        _checkDeadline(deadline);
        uint256 spent = nativeCost(p.devBuy);
        require(msg.value >= spent, "Insufficient MON for dev buy");
        BondingCurveLauncher.LaunchParams memory emptyBuy = p;
        emptyBuy.devBuy = 0;
        emptyBuy.minMemeOut = 0;
        (token, market, vault) = launcher.launch(emptyBuy);
        creatorOf[token] = msg.sender;
        if (p.devBuy != 0) {
            uint256 output = MemeMarket(market).quoteBuy(p.devBuy);
            require(output != 0 && output <= IERC20(token).totalSupply() * 75 / 100, "Dev buy exceeds 75%");
            _buy(market, IERC20(p.quoteAsset), IERC20(token), p.devBuy, p.minMemeOut, msg.sender);
            emit NativeTrade(msg.sender, market, true, spent, p.devBuy, output);
        } else {
            require(p.minMemeOut == 0, "Unexpected minimum");
        }
        _pay(msg.sender, msg.value - spent);
        emit NativeLaunch(token, market, msg.sender, spent);
    }

    function _pay(address recipient, uint256 amount) private {
        if (amount == 0) return;
        (bool success,) = payable(recipient).call{value: amount}("");
        require(success, "MON transfer failed");
    }
}
