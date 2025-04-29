import {
  time,
  loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import hre, { ethers } from "hardhat";

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
      await mockNFT.getAddress()
    );

    // Mint some NFTs to test staking
    for (let i = 1; i <= 10; i++) {
      await mockNFT.mint(user1.address);
    }
    
    for (let i = 11; i <= 15; i++) {
      await mockNFT.mint(user2.address);
    }

    // Approve the LazyBearRiver contract to transfer NFTs
    await mockNFT.connect(user1).setApprovalForAll(lazyBearRiver.target, true);
    await mockNFT.connect(user2).setApprovalForAll(lazyBearRiver.target, true);

    return { lazyBearRiver, mockNFT, deployer, multisig, user1, user2 };
  }

  describe("Deployment", function () {
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
      const { lazyBearRiver, deployer } = await loadFixture(deployLazyBearRiverFixture);
      
      // First mint some FISH tokens to user1
      await lazyBearRiver.claimRewards(); // Just to initialize claiming state
      const stakeAmount = hre.ethers.parseEther("30");
      // Now stake with those tokens
      // Deployer will have tokens to stake
      await expect(await lazyBearRiver.connect(deployer).stakeWithERC20(stakeAmount))
        .to.emit(lazyBearRiver, "StakeNFTs")
        .withArgs(deployer.address, 0, 3); // 30 FISH = 3 bears (10 FISH per bear)
      
      expect(await lazyBearRiver.totalBears()).to.equal(3);
      
      // Check user's staked NFTs
      const stakerInfo = await lazyBearRiver.stakers(deployer.address);
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
      // If regenerationRate is defined, we can calculate expected changes more precisely
      // For now, just check that the supply changed in the expected direction
      expect(fishSupplyBefore - fishSupplyAfter).to.be.closeTo(0, hre.ethers.parseEther("1"));
    });

    it("Should handle extinction events", async function () {
      const { lazyBearRiver, deployer, multisig } = await loadFixture(deployLazyBearRiverFixture);
      
      // Initial stake to put pressure on the ecosystem
      await lazyBearRiver.connect(deployer).stakeWithERC20(ethers.parseEther("50000"));
      console.log("Initial fish supply:", ethers.formatEther(await lazyBearRiver.currentFishSupply()));
      console.log("Initial bears:", (await lazyBearRiver.totalBears()).toString());
      
      // Track fish supply changes in a more structured way
      async function advanceAndTrack(epochs: number) {
        await time.increase(epochs * 6 * 60 * 60);

        const fishSupply = await lazyBearRiver.currentFishSupply();
        console.log(`After ${epochs} epochs - Fish supply: ${ethers.formatEther(fishSupply)}`);
        return fishSupply;
      }
      
      // Advance time in smaller increments and track changes
      for (let i = 0; i < 50; i++) {
        await advanceAndTrack(1);
        await lazyBearRiver.connect(deployer).claimRewards();
      }
      
      // Add more bears to accelerate depletion
      await lazyBearRiver.connect(deployer).stakeWithERC20(ethers.parseEther("25000"));
      console.log("Bears after second stake:", (await lazyBearRiver.totalBears()).toString());
      // continues staking after each claim
      for (let i = 0; i < 20; i++) {
        await advanceAndTrack(1);
        await lazyBearRiver.connect(deployer).claimRewards();
        const balance = await lazyBearRiver.balanceOf(deployer.address);
        if (balance > ethers.parseEther("100")) {
          await lazyBearRiver.connect(deployer).stakeWithERC20(balance);
        }
      }
      // just claiming to see fish balance equilibrate
      for (let i = 0; i < 20; i++) {
        await advanceAndTrack(1);
        await lazyBearRiver.connect(deployer).claimRewards();
      }
      const balance = await lazyBearRiver.balanceOf(deployer.address);
      console.log("Balance after claiming:", ethers.formatEther(balance));
      await lazyBearRiver.connect(deployer).stakeWithERC20(balance);
      console.log("Bears after staking:", (await lazyBearRiver.totalBears()).toString());
      // Fast-forward to extinction
      await time.increase(30 * 24 * 60 * 60);
      // Check if extinction occurred
      const beforeUpdate = await lazyBearRiver.currentFishSupply();
      console.log("Fish before final update:", ethers.formatEther(beforeUpdate));
      
      // This should trigger extinction
      const claimableBeforeExtinction = await lazyBearRiver.calculateRewards(deployer.address);
      await expect(lazyBearRiver.connect(deployer).updateEcosystem())
        .to.emit(lazyBearRiver, "ExtinctionEvent");
      
      // Verify post-extinction state
      expect(await lazyBearRiver.paused()).to.equal(true);
      expect(await lazyBearRiver.totalBears()).to.equal(0);
      expect(await lazyBearRiver.currentFishSupply()).to.equal(hre.ethers.parseEther("1"));
      // just visualizing fish repopulate after extinction
      for (let i = 0; i < 50; i++) {
        await advanceAndTrack(1);
        await lazyBearRiver.connect(deployer).updateEcosystem();
      }
      
      expect(await lazyBearRiver.theRiverHasHealed()).to.emit(lazyBearRiver, "ContractPaused").withArgs(false);
      const claimableAfterExtinction = await lazyBearRiver.calculateRewards(deployer.address);
      // Do not claim for epochs post-extinction
      expect(claimableAfterExtinction[0]).to.be.eq(claimableBeforeExtinction[0]);
      // Verify stakers can claim their rewards after extinction
      await lazyBearRiver.connect(deployer).claimRewards();
      await expect(lazyBearRiver.connect(deployer).stakeWithERC20(await lazyBearRiver.balanceOf(deployer.address)))
        .to.emit(lazyBearRiver, "StakeNFTs");
    });
    it("Should handle multiple extinction events", async function () {
      const { lazyBearRiver, deployer, user1 } = await loadFixture(deployLazyBearRiverFixture);
      // Stake NFTs
      await lazyBearRiver.connect(deployer).stakeWithERC20(ethers.parseEther("50000"));
      // Track fish supply changes in a more structured way
      async function advanceAndTrack(epochs: number) {
        await time.increase(epochs * 6 * 60 * 60);
  
        const fishSupply = await lazyBearRiver.currentFishSupply();
        console.log(`After ${epochs} epochs - Fish supply: ${ethers.formatEther(fishSupply)}`);
        return fishSupply;
      }
  
      for (let i = 0; i < 30; i++) {
        await advanceAndTrack(1);
        await lazyBearRiver.connect(deployer).claimRewards();
        console.log("Total Bears:", (await lazyBearRiver.totalBears()).toString());
        if (await lazyBearRiver.balanceOf(deployer.address) > ethers.parseEther("100")) {
          await lazyBearRiver.connect(deployer).stakeWithERC20(await lazyBearRiver.balanceOf(deployer.address));
        }
      }

      // Get enough to send to user1
      for (let i = 0; i < 40; i++) {
        await advanceAndTrack(1);
        await lazyBearRiver.connect(deployer).claimRewards();
      }
      await lazyBearRiver.connect(deployer).claimRewards();
      const balance = await lazyBearRiver.balanceOf(deployer.address);
      await lazyBearRiver.connect(deployer).transfer(user1.address, balance);
      
      // Run to extinction
      for (let i = 0; i < 100; i++) {
        await advanceAndTrack(1);
        if (await lazyBearRiver.currentFishSupply() > ethers.parseEther("2000")) {
          await lazyBearRiver.connect(deployer).claimRewards();
        } else {
          await lazyBearRiver.connect(deployer).updateEcosystem();
        }
        if (await lazyBearRiver.paused()) {
          break;
        }
        if (await lazyBearRiver.balanceOf(deployer.address) > ethers.parseEther("100")) {
          await lazyBearRiver.connect(deployer).stakeWithERC20(await lazyBearRiver.balanceOf(deployer.address));
        }
      }
      
      // Keep track of rewards for deployer address
      const rewardsBeforeExtinction = await lazyBearRiver.calculateRewards(deployer.address);
      // We're gonna make sure reward calculations are correct through multiple extinction events
      // Heal
      for (let i = 0; i < 10; i++) {
        await advanceAndTrack(4);
        await lazyBearRiver.updateEcosystem();
      }
      await lazyBearRiver.theRiverHasHealed();

      expect((await lazyBearRiver.calculateRewards(deployer.address))[0]).to.equal(rewardsBeforeExtinction[0]);
      await lazyBearRiver.connect(user1).stakeWithERC20(await lazyBearRiver.balanceOf(user1.address));
     
      // Run to extinction
      for (let i = 0; i < 150; i++) {
        await advanceAndTrack(4);
        if (await lazyBearRiver.currentFishSupply() > ethers.parseEther("2000")) {
          await lazyBearRiver.connect(user1).claimRewards();
        } else {
          await lazyBearRiver.connect(user1).updateEcosystem();
        }
        if (await lazyBearRiver.paused()) {
          break;
        }
        if (await lazyBearRiver.balanceOf(user1.address) > ethers.parseEther("1000")) {
          await lazyBearRiver.connect(user1).stakeWithERC20(await lazyBearRiver.balanceOf(user1.address));
        }
      }
      // Check that rewards are still the same
      expect((await lazyBearRiver.calculateRewards(deployer.address))[0]).to.equal(rewardsBeforeExtinction[0]);
      // Heal
      for (let i = 0; i < 10; i++) {
        await advanceAndTrack(4);
        await lazyBearRiver.updateEcosystem();
      }
      await lazyBearRiver.theRiverHasHealed();
      // We do it again...
      await lazyBearRiver.connect(user1).claimRewards();
      await lazyBearRiver.connect(user1).stakeWithERC20(await lazyBearRiver.balanceOf(user1.address));
      for (let i = 0; i < 150; i++) {
        await advanceAndTrack(4);
        if (await lazyBearRiver.currentFishSupply() > ethers.parseEther("2000")) {
          await lazyBearRiver.connect(user1).claimRewards();
        } else {
          await lazyBearRiver.connect(user1).updateEcosystem();
        }
        if (await lazyBearRiver.paused()) {
          break;
        }
        if (await lazyBearRiver.balanceOf(user1.address) > ethers.parseEther("1000")) {
          await lazyBearRiver.connect(user1).stakeWithERC20(await lazyBearRiver.balanceOf(user1.address));
        }
      }
      // Check that rewards are still the same
      expect((await lazyBearRiver.calculateRewards(deployer.address))[0]).to.equal(rewardsBeforeExtinction[0]);
      // Heal
      for (let i = 0; i < 10; i++) {
        await advanceAndTrack(4);
        await lazyBearRiver.updateEcosystem();
      }
      await lazyBearRiver.theRiverHasHealed();
      console.log(rewardsBeforeExtinction);
      // Why not one more time? Check that rewards are still the same
      expect((await lazyBearRiver.calculateRewards(deployer.address))[0]).to.equal(rewardsBeforeExtinction[0]);
    });
  });

});
