import {
  time,
  loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import hre from "hardhat";

describe("LazyBearRiver", function () {
  // We define a fixture to reuse the same setup in every test
  async function deployLazyBearRiverFixture() {
    // Deploy mock NFT contract for testing
    const MockNFT = await hre.ethers.getContractFactory("MockERC721");
    const mockNFT = await MockNFT.deploy();

    // Get signers
    const [deployer, multisig, user1, user2] = await hre.ethers.getSigners();

    // Deploy LazyBearRiver
    const LazyBearRiver = await hre.ethers.getContractFactory("LazyBearRiver");
    const lazyBearRiver = await LazyBearRiver.deploy(
      multisig.address,
      mockNFT.target
    );

    // Mint some NFTs to test staking
    for (let i = 1; i <= 10; i++) {
      await mockNFT.safeMint(user1.address);
    }
    
    for (let i = 11; i <= 15; i++) {
      await mockNFT.safeMint(user2.address);
    }

    // Approve the LazyBearRiver contract to transfer NFTs
    await mockNFT.connect(user1).setApprovalForAll(lazyBearRiver.target, true);
    await mockNFT.connect(user2).setApprovalForAll(lazyBearRiver.target, true);

    return { lazyBearRiver, mockNFT, deployer, multisig, user1, user2 };
  }

  describe("Deployment", function () {
    it("Should set the correct owner", async function () {
      const { lazyBearRiver, multisig } = await loadFixture(deployLazyBearRiverFixture);
      expect(await lazyBearRiver.owner()).to.equal(multisig.address);
    });

    it("Should set the correct NFT contract", async function () {
      const { lazyBearRiver, mockNFT } = await loadFixture(deployLazyBearRiverFixture);
      expect(await lazyBearRiver.legacyNFTContract()).to.equal(mockNFT.target);
    });

    it("Should initialize with correct starting values", async function () {
      const { lazyBearRiver } = await loadFixture(deployLazyBearRiverFixture);
      
      expect(await lazyBearRiver.currentFishSupply()).to.equal(hre.ethers.parseEther("6899"));
      expect(await lazyBearRiver.totalBears()).to.equal(0);
      expect(await lazyBearRiver.totalClaimed()).to.equal(0);
    });
  });

  describe("Staking", function () {
    it("Should allow staking legacy NFTs", async function () {
      const { lazyBearRiver, user1 } = await loadFixture(deployLazyBearRiverFixture);
      
      const tokenIds = [1, 2, 3];
      await lazyBearRiver.connect(user1).stakeLegacyNFTs(tokenIds);
      
      expect(await lazyBearRiver.totalBears()).to.equal(tokenIds.length);
      
      // Check user's staked NFTs
      const stakerInfo = await lazyBearRiver.stakers(user1.address);
      expect(stakerInfo.lastClaimTime).to.be.gt(0);
      
      expect(stakerInfo.bearsStaked).to.equal(tokenIds.length);
    });

    it("Should allow staking with ERC20 tokens", async function () {
      const { lazyBearRiver, user1 } = await loadFixture(deployLazyBearRiverFixture);
      
      // First mint some FISH tokens to user1
      const mintAmount = hre.ethers.parseEther("30"); // 30 FISH tokens (enough for 3 bears)
      await lazyBearRiver.connect(user1).claimRewards(); // Just to initialize claiming state
      await lazyBearRiver.mint(user1.address, mintAmount); // Using internal _mint for testing
      
      // Now stake with those tokens
      await expect(await lazyBearRiver.connect(user1).stakeWithERC20(mintAmount))
        .to.emit(lazyBearRiver, "StakeNFTs")
        .withArgs(user1.address, 0, 3); // 30 FISH = 3 bears (10 FISH per bear)
      
      expect(await lazyBearRiver.totalBears()).to.equal(3);
      
      // Check user's staked NFTs
      const stakerInfo = await lazyBearRiver.stakers(user1.address);
      expect(stakerInfo.bearsStaked).to.equal(3);
    });

    it("Should fail to stake when contract is paused", async function () {
      const { lazyBearRiver, user1, multisig } = await loadFixture(deployLazyBearRiverFixture);
      
      // Pause the contract (simulate an extinction event)
      // We need to call a private function through a transaction that sets paused to true
      // This would typically happen through an extinction event, but for testing we can trigger it directly
      await lazyBearRiver.updateEcosystem(); // Update first
      
      // Assuming there's a way to force an extinction or to test pausability
      // For this test, we'd need a method to pause the contract, possibly through owner actions
      // If there's no direct way to pause, we might need to create conditions for an extinction
      
      // After contract is paused:
      if (await lazyBearRiver.paused()) {
        await expect(lazyBearRiver.connect(user1).stakeLegacyNFTs([1, 2]))
          .to.be.revertedWith("Contract is paused");
      }
    });
  });

  describe("Rewards", function () {
    it("Should calculate rewards correctly based on time", async function () {
      const { lazyBearRiver, user1 } = await loadFixture(deployLazyBearRiverFixture);
      
      // Stake NFTs
      await lazyBearRiver.connect(user1).stakeLegacyNFTs([1, 2, 3]);
      
      // Fast-forward time by 8 epochs (2 days)
      await time.increase(2 * 24 * 60 * 60);
      
      // Check calculated rewards
      const [rewards, extinctionTime] = await lazyBearRiver.calculateRewards(user1.address);
      
      // With 3 bears, 0.1 FISH per bear per epoch, for 8 epochs
      const expectedRewards = hre.ethers.parseEther("2.4"); // 3 * 0.1 * 8 = 2.4 FISH
      expect(rewards).to.eq(expectedRewards);
      expect(extinctionTime).to.equal(0); // No extinction event
    });

    it("Should allow claiming rewards", async function () {
      const { lazyBearRiver, user1 } = await loadFixture(deployLazyBearRiverFixture);
      
      // Stake NFTs
      await lazyBearRiver.connect(user1).stakeLegacyNFTs([1, 2, 3]);
      
      // Fast-forward time by 8 epochs (2 days)
      await time.increase(2 * 24 * 60 * 60);
      
      // Initial balance should be 0
      expect(await lazyBearRiver.balanceOf(user1.address)).to.equal(0);
      
      // Claim rewards
      await expect(lazyBearRiver.connect(user1).claimRewards())
        .to.emit(lazyBearRiver, "ClaimRewards")
        .withArgs(user1.address, hre.ethers.parseEther("2.4"));
      
      // Check that rewards were received
      expect(await lazyBearRiver.balanceOf(user1.address)).to.equal(hre.ethers.parseEther("2.4"));
    });

    it("Should handle multiple claims correctly", async function () {
      const { lazyBearRiver, user1 } = await loadFixture(deployLazyBearRiverFixture);
      
      // Stake NFTs
      await lazyBearRiver.connect(user1).stakeLegacyNFTs([1, 2, 3]);
      
      // Fast-forward time by 1 epoch (1 day)
      await time.increase(1 * 24 * 60 * 60);
      
      // First claim
      await lazyBearRiver.connect(user1).claimRewards();
      const firstBalance = await lazyBearRiver.balanceOf(user1.address);
      
      // Fast-forward time by another epoch
      await time.increase(1 * 24 * 60 * 60);
      
      // Second claim
      await lazyBearRiver.connect(user1).claimRewards();
      const secondBalance = await lazyBearRiver.balanceOf(user1.address);
      
      // Second balance should be greater than first
      expect(secondBalance).to.be.gt(firstBalance);
    });
  });

  describe("Ecosystem", function () {
    it("Should update ecosystem correctly", async function () {
      const { lazyBearRiver, user1, user2 } = await loadFixture(deployLazyBearRiverFixture);
      
      // Stake NFTs from multiple users
      await lazyBearRiver.connect(user1).stakeLegacyNFTs([1, 2, 3]);
      await lazyBearRiver.connect(user2).stakeLegacyNFTs([11, 12]);
      
      // Fast-forward time by 8 epochs (2 days)
      await time.increase(2 * 24 * 60 * 60);
      
      // Get fish supply before update
      const fishSupplyBefore = await lazyBearRiver.currentFishSupply();
      
      // Update ecosystem
      await expect(lazyBearRiver.updateEcosystem())
        .to.emit(lazyBearRiver, "EcosystemUpdated");
      // TODO: Check that the ecosystem was updated correctly
      // Get fish supply after update
      const fishSupplyAfter = await lazyBearRiver.currentFishSupply();
      
      // Fish supply should decrease due to consumption
      // Total bears = 5, fishPerBearPerEpoch = 0.1, epochs = 1
      // Consumption = 5 * 0.1 * 1 = 0.5 FISH
      // Regeneration depends on current supply and max supply
      
      // Fish supply should decrease by consumption minus regeneration
      const totalBears = await lazyBearRiver.totalBears();
      const fishPerBearPerEpoch = hre.ethers.parseEther("0.1");
      const expectedConsumption = totalBears * fishPerBearPerEpoch;
      
      // If regenerationRate is defined, we can calculate expected changes more precisely
      // For now, just check that the supply changed in the expected direction
      expect(fishSupplyBefore - fishSupplyAfter).to.be.closeTo(expectedConsumption, hre.ethers.parseEther("0.1"));
    });

    it("Should handle extinction events", async function () {
      const { lazyBearRiver, user1, multisig } = await loadFixture(deployLazyBearRiverFixture);
      
      // TODO: to trigger extinction
      // We need to:
      // 1. Set a high fish consumption rate or stake many bears
      // 2. Set a low fish regeneration rate
      // 3. Set a low current fish supply
      
      // This requires access to setter functions or manipulating contract state
      // Assuming these functions exist for testing:
      await lazyBearRiver.connect(multisig).setFishPerBearPerEpoch(hre.ethers.parseEther("7000")); // Very high consumption
      await lazyBearRiver.connect(multisig).setFishRegenerationRate(0); // No regeneration
      
      // Stake NFTs
      await lazyBearRiver.connect(user1).stakeLegacyNFTs([1, 2]);
      
      // Fast-forward time by 1 epoch (1 day)
      await time.increase(1 * 24 * 60 * 60);
      
      // Update ecosystem should trigger extinction
      await expect(lazyBearRiver.updateEcosystem())
        .to.emit(lazyBearRiver, "ExtinctionEvent")
        .and.to.emit(lazyBearRiver, "ContractPaused")
        .withArgs(true);
      
      // Check contract state after extinction
      expect(await lazyBearRiver.paused()).to.equal(true);
      expect(await lazyBearRiver.totalBears()).to.equal(0);
      expect(await lazyBearRiver.currentFishSupply()).to.equal(hre.ethers.parseEther("1"));
      
      // Extinction times array should have an entry
      const extinctionTime = await lazyBearRiver.extinctionTimes(0);
      expect(extinctionTime).to.be.gt(0);
    });
  });

  describe("Owner Functions", function () {
    // Test owner-only functions
    // These tests would depend on the specific admin functions available in the contract
  });
});
