// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MemeToken} from "./MemeToken.sol";
import {BondingCurveMarket} from "./BondingCurveMarket.sol";
import {StockVault} from "./StockVault.sol";

/// @notice Creates fixed-supply bonding curves without upfront quote liquidity.
contract BondingCurveFactory is ReentrancyGuard {
    using SafeERC20 for IERC20;
    address public immutable treasury;

    event CoinCreated(
        address indexed token,
        address indexed market,
        address indexed vault,
        address creator,
        address quoteAsset,
        uint256 feeBps
    );

    constructor(address treasury_) {
        require(treasury_ != address(0), "Invalid treasury");
        treasury = treasury_;
    }

    struct CreateParams {
        address quote;
        string name;
        string symbol;
        uint256 feeBps;
    }

    function createCoin(CreateParams calldata p)
        external
        nonReentrant
        returns (address token, address market, address vault)
    {
        require(p.quote.code.length != 0, "Invalid liquidity asset");
        require(bytes(p.name).length != 0 && bytes(p.symbol).length != 0, "Empty metadata");
        require(p.feeBps == 100 || p.feeBps == 300, "Choose 1% or 3%");
        MemeToken meme = new MemeToken(p.name, p.symbol);
        BondingCurveMarket pool = new BondingCurveMarket(address(meme), p.quote, treasury, address(this), p.feeBps);
        StockVault stockVault = new StockVault(p.quote, address(pool));
        meme.registerMarket(address(pool));
        IERC20(address(meme)).safeTransfer(address(pool), meme.totalSupply());
        pool.initialize(address(stockVault), 0);
        token = address(meme);
        market = address(pool);
        vault = address(stockVault);
        emit CoinCreated(token, market, vault, msg.sender, p.quote, p.feeBps);
    }
}
