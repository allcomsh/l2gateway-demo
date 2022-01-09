const hre = require("hardhat");
const {ethers, l2ethers} = hre;
const namehash = require('eth-ens-namehash');

const OVM_ADDRESS_MANAGER = "0x3e4CFaa8730092552d9425575E49bB542e329981";
//const OVM_ADDRESS_MANAGER = "0x3e4CFaa8730092552d9425575E49bB542e329982";
//const OVM_ADDRESS_MANAGER = "0x53B7422Fb733E57C961a25B8Ed8065bac9F0085B";
//const OVM_ADDRESS_MANAGER = "0xD227AF0e36AE44e673b0143d7765Dc4dA9B64B68";
const TEST_NODE = namehash.hash('test.test');
const SNOOPY_NODE = namehash.hash('snoopy.beagles');

async function main() {
  /************************************
   * L2 deploy
   ************************************/
  // Replace the l2 provider with one that points at the l2 node
  l2ethers.provider = new l2ethers.providers.JsonRpcProvider(hre.network.config.l2url);

  // Deploy L2 resolver and set addr record for test.test
  const l2accounts = await l2ethers.getSigners();
  const OptimismResolver = await l2ethers.getContractFactory("OptimismResolver");
  const resolver = await OptimismResolver.deploy();
  await resolver.deployed();
  const resolver2 = await OptimismResolver.deploy();
  await resolver2.deployed();
  console.log(`OptimismResolver deployed to ${resolver.address}`);

  await (await resolver.functions.setAddr(TEST_NODE, l2accounts[0].address)).wait();
//  await (await resolver.functions.setAddr(SNOOPY_NODE, l2accounts[0].address)).wait();
  console.log(TEST_NODE+' Address set '+l2accounts[0].address);

  /************************************
   * L1 deploy
   ************************************/
  const accounts = await ethers.getSigners();
  await (await resolver2.functions.setAddr(SNOOPY_NODE, accounts[1].address)).wait();
  console.log(SNOOPY_NODE+' Address set '+accounts[1].address);

  // Deploy the ENS registry
  const ENS = await ethers.getContractFactory("ENSRegistry");
  const ens = await ENS.deploy();
  await ens.deployed();
  console.log(`ENS registry deployed at ${ens.address}`);

  // Create test.test owned by us
  await ens.setSubnodeOwner('0x' + '00'.repeat(32), ethers.utils.keccak256(ethers.utils.toUtf8Bytes('test')), accounts[0].address);
  await ens.setSubnodeOwner(namehash.hash('test'), ethers.utils.keccak256(ethers.utils.toUtf8Bytes('test')), accounts[0].address);
  await ens.setSubnodeOwner('0x' + '00'.repeat(32), ethers.utils.keccak256(ethers.utils.toUtf8Bytes('beagles')), accounts[0].address);
  await ens.setSubnodeOwner(namehash.hash('beagles'), ethers.utils.keccak256(ethers.utils.toUtf8Bytes('snoopy')), accounts[0].address);

  // Deploy the resolver stub
  const OptimismResolverStub = await ethers.getContractFactory("OptimismResolverStub");
  const stub = await OptimismResolverStub.deploy(OVM_ADDRESS_MANAGER, "http://localhost:8081/query", resolver.address);
  await stub.deployed();
  const stub2 = await OptimismResolverStub.deploy(OVM_ADDRESS_MANAGER, "http://localhost:8081/query", resolver2.address);
  await stub2.deployed();

  // Set the stub as the resolver for test.test
  await ens.setResolver(namehash.hash('test.test'), stub.address);
  await ens.setResolver(namehash.hash('snoopy.beagles'), stub2.address);

  console.log(`${OVM_ADDRESS_MANAGER} OptimismResolverStub deployed at ${stub.address}`);
  console.log(`${OVM_ADDRESS_MANAGER} OptimismResolverStub deployed at ${stub2.address}`);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
