pragma solidity ^0.7.6;
pragma abicoder v2;
import './MockRegistry.sol';

contract AppResolverStub {
  MockRegistry public ens;
  string public gateway;
  address public l2resolver;

  struct Proof {
    bytes signature;
    address ownerAddress;
  }

  constructor(MockRegistry _ens, string memory _gateway, address _l2resolver) {
    ens = _ens;
    gateway = _gateway;
    l2resolver = _l2resolver;
  }

  function addr(bytes32 node) external view returns(bytes memory prefix, string memory url) {
    return (abi.encodeWithSelector(AppResolverStub.addrWithProof.selector, node), gateway);
  }

  function addrWithProof(bytes32 node, Proof memory proof) external view returns(address) {
    address recovered = recoverAddress(node, proof);
    require(ens.owner(node) == recovered, "Signer is not the domain owner");
    return recovered;
  }

  function recoverAddress(bytes32 node, Proof memory proof) internal pure returns(address) {
    (uint8 v, bytes32 r, bytes32 s) = splitSignature(proof.signature);
    bytes32 messageHash = keccak256(abi.encodePacked(node));
    bytes32 ethSignedMessageHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));
    return ecrecover(ethSignedMessageHash, v, r, s);
  }

  /// signature methods.
  function splitSignature(bytes memory sig)
      internal
      pure
      returns (uint8 v, bytes32 r, bytes32 s)
  {
      require(sig.length == 65);
      assembly {
          // first 32 bytes, after the length prefix.
          r := mload(add(sig, 32))
          // second 32 bytes.
          s := mload(add(sig, 64))
          // final byte (first byte of the next 32 bytes).
          v := byte(0, mload(add(sig, 96)))
      }
      return (v, r, s);
  }
}
