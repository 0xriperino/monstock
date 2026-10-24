// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MemeToken} from "./MemeToken.sol";
import {MemeMarket} from "./MemeMarket.sol";
// Owned by Developer 2. Required for integrated compilation; do not replace with a stub.
import {StockVault} from "./StockVault.sol";

/// @notice StockBack launchpad for Monad Testnet (chain 10143), using a fixed test-only stock asset.
/// @dev Requires Developer 2's StockVault.sol with constructor(address stockToken, address market).
/// Liquidity is permanently locked; there are no LP tokens or withdrawal methods.
/// Validation: forge build; forge test. Until StockVault is merged, independent checks:
/// forge build --skip StockBackFactory.sol
/// forge test --skip StockBackFactory.sol --no-match-test testFactory
/// Fee rounding remainder goes to treasury. Holder distribution dust remains reserved.
/// Reward allocation uses settlement-time balances and permits last-minute positioning.
contract StockBackFactory is ReentrancyGuard {
    using SafeERC20 for IERC20;
    IERC20 public immutable stockToken;
    address public immutable treasury;
    address[] private markets;

    event CoinCreated(address indexed memeToken, address indexed market, address indexed vault, address creator);

    constructor(address stockToken_, address treasury_) {
        require(stockToken_.code.length != 0 && treasury_ != address(0), "Invalid address");
        stockToken = IERC20(stockToken_);
        treasury = treasury_;
    }

    function createCoin(string calldata name, string calldata symbol, uint256 initialStockLiquidity)
        external
        nonReentrant
        returns (address memeToken, address market, address vault)
    {
        require(bytes(name).length != 0 && bytes(symbol).length != 0, "Empty metadata");
        require(initialStockLiquidity != 0, "Zero liquidity");
        MemeToken token = new MemeToken(name, symbol);
        MemeMarket pool = new MemeMarket(address(token), address(stockToken), treasury, address(this));
        StockVault stockVault = new StockVault(address(stockToken), address(pool));
        token.registerMarket(address(pool));
        stockToken.safeTransferFrom(msg.sender, address(pool), initialStockLiquidity);
        IERC20(address(token)).safeTransfer(address(pool), token.totalSupply());
        pool.initialize(address(stockVault), initialStockLiquidity);
        markets.push(address(pool));
        memeToken = address(token);
        market = address(pool);
        vault = address(stockVault);
        emit CoinCreated(memeToken, market, vault, msg.sender);
    }

    function getMarkets() external view returns (address[] memory) {
        return markets;
    }
}
