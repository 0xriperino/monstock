// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice TEST ONLY: demonstration asset, not a real stock or security.
contract MockStock is ERC20 {
    mapping(address => bool) public hasClaimed;

    constructor() ERC20("Mock Stock", "MockSPYx") {}

    function faucet() external {
        require(!hasClaimed[msg.sender], "Already claimed");
        hasClaimed[msg.sender] = true;
        _mint(msg.sender, 10_000 ether);
    }
}
