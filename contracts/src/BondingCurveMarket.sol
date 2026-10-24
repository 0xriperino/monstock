// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {MemeMarket} from "./MemeMarket.sol";

/// @notice Continuous constant-product bonding curve with virtual quote backing.
/// Virtual quote is only a pricing parameter; payouts use actual collected reserves.
contract BondingCurveMarket is MemeMarket {
    uint256 public constant VIRTUAL_QUOTE_RESERVE = 1000 ether;

    constructor(address token, address quote, address treasury_, address factory_, uint256 feeBps)
        MemeMarket(token, quote, treasury_, factory_)
    {
        require(feeBps == 100 || feeBps == 300, "Choose 1% or 3%");
        tradingFeeBps = feeBps;
    }

    function initialize(address vault_, uint256 stockLiquidity) external override {
        require(msg.sender == factory, "Factory only");
        require(vault == address(0), "Already initialized");
        require(vault_.code.length != 0 && stockLiquidity == 0, "Invalid curve initialization");
        uint256 inventory = memeToken.balanceOf(address(this));
        require(inventory == memeToken.totalSupply() && inventory != 0, "Missing meme supply");
        vault = vault_;
        _stockReserve = 0;
        _memeReserve = inventory;
        nextEpochAt = block.timestamp + EPOCH_DURATION;
    }

    function getPricingReserves() external view returns (uint256 virtualQuote, uint256 memeInventory) {
        return (VIRTUAL_QUOTE_RESERVE + _stockReserve, _memeReserve);
    }

    function quoteBuy(uint256 stockIn) public view override initialized returns (uint256) {
        uint256 net = stockIn - Math.mulDiv(stockIn, tradingFeeBps, 10_000);
        return Math.mulDiv(_memeReserve, net, VIRTUAL_QUOTE_RESERVE + _stockReserve + net);
    }

    function _grossSell(uint256 memeIn) internal view override returns (uint256 gross) {
        gross = Math.mulDiv(VIRTUAL_QUOTE_RESERVE + _stockReserve, memeIn, _memeReserve + memeIn);
        require(gross <= _stockReserve, "Insufficient curve backing");
    }
}
