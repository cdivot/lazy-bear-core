# Sample Hardhat Project

This project demonstrates a basic Hardhat use case. It comes with a sample contract, a test for that contract, and a Hardhat Ignition module that deploys that contract.

Try running some of the following tasks to compile and test the contract:

```shell
npx hardhat compile
npx hardhat test
```

# LazyBear River - Smart Contract Documentation

## Overview

LazyBear River is an ecosystem simulation implemented as a smart contract on the Ethereum blockchain. It combines NFT staking with an ecological model that simulates population dynamics using logistic growth principles. The contract allows users to stake NFTs (representing bears) to earn ERC20 tokens (representing fish), while maintaining a delicate balance in the virtual ecosystem.

## Key Features

- **NFT Staking**: Users can stake legacy NFTs or create virtual bears using FISH tokens
- **Ecological Simulation**: Fish population follows a logistic growth model (ΔN = r × N × (K-N)/K)
- **Extinction Events**: If bears consume too many fish, the ecosystem collapses and resets
- **Permanent Staking**: NFTs cannot be withdrawn once staked (one-way mechanism)
- **Reward System**: Stakers earn FISH tokens based on the number of bears they've staked

## Core Mechanics

### Ecological Model

The contract simulates a river ecosystem with two main components:
- **Bears**: Represented by staked NFTs, they consume fish
- **Fish**: ERC20 tokens that regenerate according to ecological principles

The fish population follows a logistic growth model:
- Growth rate depends on current population and carrying capacity
- Bears consume fish at a constant rate per epoch
- If consumption exceeds available fish, an extinction event occurs

### Epochs and Rewards

- Each epoch lasts 6 hours
- Bears earn 0.1 FISH per epoch
- Rewards can be claimed at any time
- Rewards are calculated based on the number of bears staked and epochs passed

### Extinction Events

When bears consume too many fish:
1. All bears die (totalBears resets to 0)
2. Fish population resets to a minimal level (1 FISH)
3. Contract enters a paused state
4. The river must "heal" (fish must repopulate) before staking can resume
5. Stakers retain their earned rewards but lose their bears

## Technical Parameters

- **EPOCH_LENGTH**: 6 hours
- **BEAR_COST**: 10 FISH tokens
- **FISH_PER_BEAR_PER_EPOCH**: 0.1 FISH
- **CARRYING_CAPACITY**: 6900 FISH
- **FISH_REGRESSION_RATE**: 50 (growth rate parameter)
- **POPULATION_SCALING_FACTOR**: 100 (scaling factor for calculations)

## Contract Functions

### Staking Functions
- `stakeLegacyNFTs(uint256[] memory tokenIds)`: Stake existing NFTs
- `stakeWithERC20(uint256 amount)`: Create virtual bears by burning FISH tokens

### Reward Functions
- `claimRewards()`: Claim accumulated FISH rewards
- `calculateRewards(address sender)`: Calculate pending rewards for an address

### Ecosystem Functions
- `updateEcosystem()`: Update the fish population based on ecological model
- `theRiverHasHealed()`: Unpause the contract after an extinction event

### Utility Functions
- `getCurrentEpoch()`: Get the current epoch number
- `getEpochFromTimestamp(uint256 timestamp)`: Convert timestamp to epoch number

## Security Considerations

- **Reentrancy Protection**: The contract uses OpenZeppelin's ReentrancyGuard
- **Extinction Handling**: The contract properly handles extinction events and reward calculations across extinctions
- **Permanent Staking**: NFTs cannot be withdrawn, which is an intentional design choice
- **Binary Search Algorithm**: Used for efficient extinction time lookup in reward calculations

## Edge Cases to Audit

1. **Multiple Extinction Events**: Verify that reward calculations remain accurate across multiple extinction events
2. **Ecosystem Parameter Sensitivity**: Check if the ecological parameters can lead to unexpected behavior
3. **Reward Calculation Precision**: Ensure no rounding errors in reward calculations
4. **Gas Optimization**: Check for potential gas optimization in the binary search algorithm
5. **Paused State Transitions**: Verify correct behavior when transitioning between paused and unpaused states

## Testing

The contract includes comprehensive tests covering:
- Basic staking and claiming functionality
- Ecosystem updates and fish population dynamics
- Extinction events and recovery
- Multiple extinction events with reward preservation
- Edge cases around pausing and unpausing

## Dependencies

- OpenZeppelin Contracts v4.8.20:
  - ERC20
  - IERC721
  - IERC721Receiver
  - ReentrancyGuard

## Development

This project uses Hardhat for development and testing.

Try running some of the following tasks:
