// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title Lazy Bear River
 * @dev ERC20 token that allows staking NFTs for rewards.
 * simulating population dynamics using logistic growth: ΔN = r × N × (K-N)/K
 *
 * NFTs cannot be withdrawn once staked.
 * Virtual NFTs are created onchain, with metadata available offchain.
 */
contract LazyBearRiver is ERC20, IERC721Receiver, ReentrancyGuard {
  /****** CONSTANTS ******/
  uint256 private constant EPOCH_LENGTH = 6 hours;
  uint256 private constant BASIS = 10000;
  uint256 private constant BEAR_COST = 10 ether;
  uint256 private constant FISH_PER_BEAR_PER_EPOCH = 0.1 ether;

  /****** ECOLOGICAL PARAMETERS ******/
  uint256 private constant POPULATION_SCALING_FACTOR = 1000;
  uint256 private constant CARRYING_CAPACITY = 6900 ether;
  uint256 private constant FISH_REGRESSION_RATE = 666;

  /****** TRACKING VARIABLES ******/
  uint256 public currentFishSupply;
  uint256 public totalBears;
  uint256 public totalClaimed;

  /****** EPOCH ********/
  uint256 private lastUpdateTime; // last time the reward rate was updated
  uint256 public startTime;
  bool public paused;
  uint256[] public extinctionTimes;

  /****** STAKERS ********/
  struct Staker {
    uint256 lastClaimTime;
    uint256 bearsStaked;
  }
  mapping(address => Staker) public stakers;

  /****** NFTs ********/
  IERC721 public legacyNFTContract;

  /****** EVENTS ********/
  event StakeNFTs(address indexed staker, uint256 tokenId, uint256 amount);
  event ClaimRewards(address indexed staker, uint256 amount);
  event RewardRateChanged(uint256 oldRate, uint256 newRate);
  event RiverSupplyCapChanged(uint256 oldCap, uint256 newCap);
  event ExtinctionEvent(uint256 timestamp);
  event ContractPaused(bool paused);
  event EcosystemUpdated(uint256 fishSupply, uint256 bears);

  constructor(address _legacyNFTContract) ERC20("lazy fish", "FISH") {
    // For LP
    _mint(msg.sender, 33_000 ether);
    startTime = block.timestamp;
    lastUpdateTime = block.timestamp;
    currentFishSupply = 6899 * 1 ether;
    require(currentFishSupply < CARRYING_CAPACITY, "River cannot exceed max supply");
    legacyNFTContract = IERC721(_legacyNFTContract);
  }

  // TODO: TESTING ONLY REMOVE THIS FOR PROD
  function mint(address to, uint256 amount) public {
    _mint(to, amount);
  }

  /****** STAKE FUNCTIONS ********/
  function stakeLegacyNFTs(uint256[] memory tokenIds) external nonReentrant {
    require(!paused, "Contract is paused");
    require(tokenIds.length != 0, "No tokens to stake");
    (bool extinction) = _updateEcosystem();
    _claimRewards(msg.sender);

    // If extinction event occurred, do not allow staking
    if (extinction) {
      return;
    }

    uint256 length = tokenIds.length;
    for (uint256 i = 0; i < length; i++) {
      legacyNFTContract.safeTransferFrom(msg.sender, address(this), tokenIds[i]);
      emit StakeNFTs(msg.sender, tokenIds[i], 1);
    }
    totalBears += length;
    stakers[msg.sender].bearsStaked += length;
  }

  function stakeWithERC20(uint256 amount) external nonReentrant {
    require(!paused, "Contract is paused");
    require(amount >= BEAR_COST, "Cannot stake less than 10 FISH");
    (bool extinction) = _updateEcosystem();
    _claimRewards(msg.sender);
    
    // If extinction event occurred, do not allow staking
    if (extinction) {
      return;
    }

    // Calculate how many NFT IDs to mint (1 ID per 10 FISH)
    uint256 idsToMint = amount / BEAR_COST;
    
    // Burn FISH tokens from user
    _burn(msg.sender, idsToMint * BEAR_COST);
    
    // Add the minted IDs to the user's staked NFTs
    Staker storage staker = stakers[msg.sender];
    
    staker.bearsStaked += idsToMint;
    totalBears += idsToMint;
    emit StakeNFTs(msg.sender, 0, idsToMint);
  }

  /****** CLAIM FUNCTIONS ********/
  function claimRewards() external nonReentrant {
    _updateEcosystem();
    _claimRewards(msg.sender);
  }

  function _claimRewards(address sender) internal {
    Staker storage staker = stakers[sender];
    
    (uint256 rewards, uint256 relevantExtinctionTime) = calculateRewards(sender);
    
    // If there was an extinction event since last claim
    if (relevantExtinctionTime > 0) {
      // Reset the bears staked
      stakers[sender].bearsStaked = 0;
    }
    
    if (rewards > 0) {
      _mint(sender, rewards);
      totalClaimed += rewards;
      emit ClaimRewards(sender, rewards);
    }
    staker.lastClaimTime = block.timestamp;
  }
  
  function calculateRewards(address sender) public view returns (uint256 rewards, uint256 relevantExtinctionTime) {
    Staker memory staker = stakers[sender];
    
    if (extinctionTimes.length > 0) {
      uint256 left = 0;
      uint256 right = extinctionTimes.length - 1;
      uint256 result = type(uint256).max; // Default to an invalid index
      
      // If last claim is before first extinction, return the first extinction time
      // Calculate rewards comes after an extinction event
      if (staker.lastClaimTime <= extinctionTimes[0]) {
        relevantExtinctionTime = extinctionTimes[0];
      }
      // If last claim is after the most recent extinction, no relevant extinction
      else if (staker.lastClaimTime > extinctionTimes[right]) {
        relevantExtinctionTime = 0;
      }
      // Binary search to find the first extinction time after lastClaimTime
      else {
        while (left <= right) {
          uint256 mid = left + (right - left) / 2;
          
          if (extinctionTimes[mid] > staker.lastClaimTime) {
            // This could be our result, but there might be an earlier one
            result = mid;
            if (mid == 0) {  // Add this check to prevent underflow
              break;
            }
            right = mid - 1;
          } else {
            // This extinction is too early, look in the right half
            left = mid + 1;
          }
        }
        
        // If we found a valid result, use it
        if (result != type(uint256).max) {
          relevantExtinctionTime = extinctionTimes[result];
        }
      }
    }
    
    // If there was an extinction event since last claim
    if (relevantExtinctionTime > 0) {
      uint256 epochsBeforeExtinction = getEpochFromTimestamp(relevantExtinctionTime) - getEpochFromTimestamp(staker.lastClaimTime);
      return (FISH_PER_BEAR_PER_EPOCH * staker.bearsStaked * epochsBeforeExtinction, relevantExtinctionTime);
    }
    
    // Normal reward calculation
    uint256 epochsPassed = getCurrentEpoch() - getEpochFromTimestamp(staker.lastClaimTime);
    if (epochsPassed > 0 && staker.bearsStaked > 0) {
      rewards = FISH_PER_BEAR_PER_EPOCH * staker.bearsStaked * epochsPassed;
    }
    return (rewards, relevantExtinctionTime);
  }


  /****** ECOLOGICAL FUNCTIONS ********/
  function updateEcosystem() external nonReentrant {
    _updateEcosystem();
  }

  function _updateEcosystem() internal returns (bool extinction) {
    uint256 timeElapsed = block.timestamp - lastUpdateTime;    
    // Calculate number of epochs that have passed
    uint256 epochs = timeElapsed / EPOCH_LENGTH;
    if (epochs == 0) return false;
    
    // Step 1: Calculate fish consumption by bears
    uint256 totalConsumption = totalBears * FISH_PER_BEAR_PER_EPOCH * epochs;
    
    // Step 2: Calculate fish regeneration using logistic growth
    // Formula: ΔN = r × N × (K-N)/K where:
    // - r is growth rate
    // - N is current population
    // - K is carrying capacity
    uint256 regeneration = 0;
    uint256 _currentFishSupply = currentFishSupply;
    if (_currentFishSupply < CARRYING_CAPACITY) {
      uint256 remainingCapacity = CARRYING_CAPACITY - _currentFishSupply;
      uint256 growthFactor = _currentFishSupply * remainingCapacity / CARRYING_CAPACITY;
      regeneration = FISH_REGRESSION_RATE * growthFactor * epochs / POPULATION_SCALING_FACTOR;
    }
    
    // Step 3: Update fish supply
    if (totalConsumption > _currentFishSupply + regeneration) {
      // Extinction event - not enough fish... resetting ecosystem
      totalBears = 0;
      currentFishSupply = 1 ether;
      extinctionTimes.push(block.timestamp);
      paused = true; // the river must heal...
      lastUpdateTime = block.timestamp;
      emit ContractPaused(true);
      emit ExtinctionEvent(block.timestamp);
      emit EcosystemUpdated(1 ether, 0);
      return true;
    } else {
      // Normal case: add regeneration, subtract consumption
      currentFishSupply = _currentFishSupply + regeneration - totalConsumption;
    }
    
    lastUpdateTime = block.timestamp;    
    emit EcosystemUpdated(currentFishSupply, totalBears);
    return false;
  }

  function getCurrentEpoch() public view returns (uint256) {
    return (block.timestamp - startTime) / EPOCH_LENGTH;
  }

  function getEpochFromTimestamp(uint256 timestamp) public view returns (uint256) {
    // Add underflow protection
    if (timestamp <= startTime) {
      return 0;
    }
    return (timestamp - startTime) / EPOCH_LENGTH;
  }

  /****** RESET ********/
  function theRiverHasHealed() external nonReentrant {
    require(paused, "River is not paused");
    // Around Max Supply
    require(currentFishSupply == CARRYING_CAPACITY - 10 ether, "River is not full enough`");
    paused = false;
    emit ContractPaused(false);
  }

  /****** IERC721Receiver ********/
  /**
   * @dev Implementation of IERC721Receiver interface
   * This function is called by the NFT contract when tokens are transferred to this contract
   */
  function onERC721Received(
      address operator,
      address from,
      uint256 tokenId,
      bytes calldata data
  ) external override returns (bytes4) {
      // Basic implementation to accept the NFT
      return this.onERC721Received.selector;
  }
}
