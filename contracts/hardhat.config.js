require("@nomiclabs/hardhat-waffle");
require("@nomiclabs/hardhat-ethers");
require('@eth-optimism/plugins/hardhat/compiler');
require('@eth-optimism/plugins/hardhat/ethers');

module.exports = {
  networks: {
    integration: {
      url: "http://app.beagle.chat:9545/",
      l2url: "http://app.beagle.chat:8545/"
    }
  },
  namedAccounts: {
    deployer: {
      default: 0
    }
  },
  solidity: {
    version: "0.7.6",
  },
};
