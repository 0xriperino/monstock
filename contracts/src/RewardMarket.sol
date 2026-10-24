// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MemeMarket} from "./MemeMarket.sol";

/// @notice Reward market with a launch-time fee of 1% or 3%, without a fee setter.
contract RewardMarket is MemeMarket {
    constructor(address token, address quote, address treasury, address factory, uint256 feeBps)
        MemeMarket(token, quote, treasury, factory)
    {
        require(feeBps == 100 || feeBps == 300, "Choose 1% or 3%");
        tradingFeeBps = feeBps;
    }
}
