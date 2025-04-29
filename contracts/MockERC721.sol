// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/**
 * @title MockERC721
 * @dev A simple mock implementation of the ERC721 standard for testing purposes
 */
contract MockERC721 is ERC721 {
    uint256 private _tokenIdCounter = 1;

    constructor() ERC721("MOCK", "MOCK") {}
    
    /**
     * @dev Mints a new token
     * @param to The address that will receive the minted token
     * @return The ID of the newly minted token
     */
    function mint(address to) public returns (uint256) {
        uint256 tokenId = _tokenIdCounter;
        _tokenIdCounter++;
        _safeMint(to, tokenId);
        return tokenId;
    }
}
