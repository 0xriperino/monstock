// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {StockBackFactory} from "./StockBackFactory.sol";
import {BondingCurveFactory} from "./BondingCurveFactory.sol";
import {MemeMarket} from "./MemeMarket.sol";

/// @notice Creates zero-liquidity bonding curves, with immutable
/// metadata and an optional atomic first buy. No owner, platform charge or custody.
contract BondingCurveLauncher is ReentrancyGuard {
    using SafeERC20 for IERC20;

    BondingCurveFactory public immutable rewardFactory;
    mapping(address => address[]) private launchedMarkets;
    mapping(address => address) public factoryFor;
    mapping(address => string) public metadata;
    mapping(address => address) public creatorOf;
    uint256 public constant MAX_METADATA_BYTES = 16_384;

    struct LaunchParams {
        address quoteAsset;
        string name;
        string symbol;
        uint256 feeBps;
        uint256 devBuy;
        uint256 minMemeOut;
        string metadataJSON;
    }

    event TokenLaunched(
        address indexed token,
        address indexed market,
        address indexed creator,
        address vault,
        address quoteAsset,
        uint256 devBuy
    );

    constructor(address[] memory factories, address rewardFactory_) {
        require(rewardFactory_.code.length != 0, "Invalid reward factory");
        rewardFactory = BondingCurveFactory(rewardFactory_);
        require(factories.length != 0, "No factories");
        for (uint256 i; i < factories.length; ++i) {
            require(factories[i].code.length != 0, "Invalid factory");
            address asset = address(StockBackFactory(factories[i]).stockToken());
            require(factoryFor[asset] == address(0), "Duplicate asset");
            factoryFor[asset] = factories[i];
        }
    }

    function getMarkets(address quoteAsset) external view returns (address[] memory) {
        return launchedMarkets[quoteAsset];
    }

    function launch(LaunchParams calldata p)
        external
        nonReentrant
        returns (address token, address market, address vault)
    {
        require(factoryFor[p.quoteAsset] != address(0), "Unsupported quote asset");
        require(bytes(p.name).length > 0 && bytes(p.name).length <= 128, "Invalid name");
        require(bytes(p.symbol).length > 0 && bytes(p.symbol).length <= 12, "Invalid symbol");
        require(bytes(p.metadataJSON).length <= MAX_METADATA_BYTES, "Metadata too large");
        require(p.devBuy != 0 || p.minMemeOut == 0, "Unexpected minimum");

        IERC20 quote = IERC20(p.quoteAsset);
        (token, market, vault) =
            rewardFactory.createCoin(BondingCurveFactory.CreateParams(p.quoteAsset, p.name, p.symbol, p.feeBps));
        launchedMarkets[p.quoteAsset].push(market);
        metadata[token] = p.metadataJSON;
        creatorOf[token] = msg.sender;

        if (p.devBuy != 0) {
            uint256 output = MemeMarket(market).quoteBuy(p.devBuy);
            require(output != 0 && output <= IERC20(token).totalSupply() * 75 / 100, "Dev buy exceeds 75%");
            quote.safeTransferFrom(msg.sender, address(this), p.devBuy);
            quote.forceApprove(market, p.devBuy);
            MemeMarket(market).buy(p.devBuy, p.minMemeOut);
            IERC20(token).safeTransfer(msg.sender, output);
        }
        emit TokenLaunched(token, market, msg.sender, vault, p.quoteAsset, p.devBuy);
    }
}
