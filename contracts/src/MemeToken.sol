// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface IHolderCheckpoint {
    function checkpoint(address from, address to) external;
}

contract MemeToken is ERC20 {
    address public immutable factory;
    address public market;

    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {
        factory = msg.sender;
        _mint(msg.sender, 1_000_000 ether);
    }

    function registerMarket(address market_) external {
        require(msg.sender == factory, "Factory only");
        require(market == address(0), "Market already registered");
        require(market_.code.length != 0, "Invalid market");
        market = market_;
    }

    /// @dev Only the registered market receives callbacks, before balances change.
    function _update(address from, address to, uint256 value) internal override {
        if (market != address(0)) IHolderCheckpoint(market).checkpoint(from, to);
        super._update(from, to, value);
    }
}
