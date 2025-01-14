import cors from 'cors';
import { ethers, BigNumber } from 'ethers';
import express from 'express';
import * as fs from 'fs';
import { MerkleTree } from 'merkletreejs'
import { OptimismResolver } from './contracts/OptimismResolver';
import { OptimismResolverStub__factory } from './contracts/factories/OptimismResolverStub__factory';
import { OptimismResolverStub } from './contracts/OptimismResolverStub';
import { loadContract, loadContractFromManager } from './ovm-contracts';
import { RLP } from 'ethers/lib/utils';

// Instantiate the ethers provider
const L1_PROVIDER_URL = "http://app.beagle.chat:9545/";
const l1_provider = new ethers.providers.JsonRpcProvider(L1_PROVIDER_URL);

const L2_PROVIDER_URL = "http://app.beagle.chat:8545/";
const l2_provider = new ethers.providers.JsonRpcProvider(L2_PROVIDER_URL);

const ADDRESS_MANAGER_ADDRESS = '0x3e4CFaa8730092552d9425575E49bB542e329981';
//const OVM_ADDRESS_MANAGER = "0x3e4CFaa8730092552d9425575E49bB542e329981";
//const ADDRESS_MANAGER_ADDRESS = '0x247ADeE8E350cBEB05aB73DE88Be07CFbD736b2E';
//const ADDRESS_MANAGER_ADDRESS = '0x714b1AC40b6BD813E3cE0981780B928946A1E0ba';
//const ADDRESS_MANAGER_ADDRESS = '0x5Ed3Cb3374f37C25Ab8C4e74c847D9b744b55Cc8';
//const ADDRESS_MANAGER_ADDRESS = '0xD227AF0e36AE44e673b0143d7765Dc4dA9B64B68';


// Instantiate the manager
const ovmAddressManager = loadContract('Lib_AddressManager', ADDRESS_MANAGER_ADDRESS, l1_provider);

// Configure the webapp
const app = express();
app.use(cors());
app.use(express.json());
const port = 8081;

interface StateRootBatchHeader {
    batchIndex: BigNumber
    batchRoot: string
    batchSize: BigNumber
    prevTotalElements: BigNumber
    extraData: string
}

async function getLatestStateBatchHeader(): Promise<{batch: StateRootBatchHeader, stateRoots: string[]}> {
    // Instantiate the state commitment chain
    const ovmStateCommitmentChain = await loadContractFromManager('OVM_StateCommitmentChain', ovmAddressManager, l1_provider);

    for(let endBlock = await l1_provider.getBlockNumber(); endBlock > 0; endBlock = Math.max(endBlock - 100, 0)) {
        const startBlock = Math.max(endBlock - 100, 1);
        const events: ethers.Event[] = await ovmStateCommitmentChain.queryFilter(
            ovmStateCommitmentChain.filters.StateBatchAppended(), startBlock, endBlock);
        if(events.length > 0) {
            const event = events[events.length - 1];
            const tx = await l1_provider.getTransaction(event.transactionHash);
            const [ stateRoots ] = ovmStateCommitmentChain.interface.decodeFunctionData('appendStateBatch', tx.data);
            return {
                batch: {
                    batchIndex: event.args?._batchIndex,
                    batchRoot: event.args?._batchRoot,
                    batchSize: event.args?._batchSize,
                    prevTotalElements: event.args?._prevTotalElements,
                    extraData: event.args?._extraData,
                },
                stateRoots,
            }
        }
    }
    throw Error("No state root batches found");
}

// Function handlers for functions implemented by this l2 gateway. Each accepts the address of the
// contract being called and the decoded arguments to the function, and is expected to return
// the encoded calldata for the 'real' function.
const functionHandlers: {[key: string]: (contract: ethers.Contract, args: ethers.utils.Result) => Promise<any>} = {};

functionHandlers['addr'] = async (contract: ethers.Contract, [ node ]) => {
    console.log('addr-1:'+JSON.stringify(node));
    const stateBatchHeader = await getLatestStateBatchHeader();
    // The l2 block number we'll use is the last one in the state batch
    const l2BlockNumber = stateBatchHeader.batch.prevTotalElements.add(stateBatchHeader.batch.batchSize);

    console.log('addr-2:'+JSON.stringify(stateBatchHeader));
    // Construct a merkle proof for the state root we need
    const elements = []
    for (
      let i = 0;
      i < Math.pow(2, Math.ceil(Math.log2(stateBatchHeader.stateRoots.length)));
      i++
    ) {
      if (i < stateBatchHeader.stateRoots.length) {
        elements.push(stateBatchHeader.stateRoots[i])
      } else {
        elements.push(ethers.utils.keccak256('0x' + '00'.repeat(32)))
      }
    }
    console.log('addr-3:'+JSON.stringify(elements));
    const hash = (el: Buffer | string): Buffer => {
      return Buffer.from(ethers.utils.keccak256(el).slice(2), 'hex')
    }
    console.log('addr-4:'+JSON.stringify(hash));
    const leaves = elements.map((element) => {
      return Buffer.from(element.slice(2), 'hex')
    })
    const index = elements.length - 1;
    const tree = new MerkleTree(leaves, hash)
    const treeProof = tree.getProof(leaves[index], index).map((element) => {
      return element.data
    });

    // Get the address for the L2 resolver contract, and the slot that contains the data we want
    const l2ResolverAddress = await contract.l2resolver();
    const addrSlot = ethers.utils.keccak256(node + '00'.repeat(31) + '01');

    // Get a proof of the contents of that slot at the required L2 block
    try {
        console.log('addr-5:'+JSON.stringify(l2BlockNumber));
        const proof = await l2_provider.send('eth_getProof', [
            l2ResolverAddress,
            [addrSlot],
            '0x' + BigNumber.from(l2BlockNumber).toHexString().slice(2).replace(/^0+/, '')
        ]);
    const addr = ethers.utils.hexDataSlice(ethers.utils.hexZeroPad(proof.storageProof[0].value, 32), 12);

    const data = [
        node,
        {
            stateRoot: stateBatchHeader.stateRoots[index],
            stateRootBatchHeader: stateBatchHeader.batch,
            stateRootProof: {
                index,
                siblings: treeProof,
            },
            stateTrieWitness: RLP.encode(proof.accountProof),
            storageTrieWitness: RLP.encode(proof.storageProof[0].proof),
        }
    ];
    return contract.interface.encodeFunctionData('addrWithProof', data);
    } catch (e) {
        console.log(JSON.stringify(e));
    }
}

// functionHandlers['claimableBalance'] = (contractAddress, [ address ]) => {
//     const [ balance, proof ] = getBalanceAndProof(address);
//     return merkleInterface.encodeFunctionData('claimableBalanceWithProof', [address, balance, proof]);
// };

// functionHandlers['claim'] = (contractAddress, [ address ]) => {
//     const [ balance, proof ] = getBalanceAndProof(address);
//     return merkleInterface.encodeFunctionData('claimWithProof', [address, balance, proof]);
// };

app.post('/query', async (req, res) => {
    const { address, data } = req.body;
//    const contract = OptimismResolverStub__factory.connect(address, l2_provider);
    const contract = OptimismResolverStub__factory.connect(address, l1_provider);
    const functionId = data.slice(0, 10);
    let fragment;
    try {
        console.log(JSON.stringify(address));
        console.log(JSON.stringify(data));
        console.log(JSON.stringify(functionId));
//        console.log(JSON.stringify(contract.interface.fragments));
        fragment = contract.interface.getFunction(functionId);
    } catch(e) {
        console.log('1:'+JSON.stringify(res));
        res.status(400).json({
            'error': e.reason
        });
        return;
    }
    const handler = functionHandlers[fragment.name];
    if(!handler || handler === undefined) {
        console.log('2:'+JSON.stringify(res));
        res.status(400).json({
            'error': "Function not implemented"
        });
        return;
    }
    const args = contract.interface.decodeFunctionData(functionId, data);
    console.log('2q:'+JSON.stringify(fragment.name));
//    console.log('2:'+JSON.stringify(handler));
    console.log('3:'+JSON.stringify(args));
    res.json({
        data: await handler(contract, args)
    });
});

app.listen(port, () => {
    console.log(`Listening at http://localhost:${port}`);
});
