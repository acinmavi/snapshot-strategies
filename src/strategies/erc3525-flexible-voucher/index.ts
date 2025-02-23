import { BigNumber } from '@ethersproject/bignumber';
import { hexZeroPad } from '@ethersproject/bytes';
import { formatUnits } from '@ethersproject/units';
import { Multicaller } from '../../utils';
import { claimCoefficient, maturitiesCoefficient } from './utils';

export const author = 'buchaoqun';
export const version = '0.1.0';

const abi = [
  'function getSnapshot(uint256 tokenId) view returns (tuple(tuple(address issuer, uint8 claimType, uint64 startTime, uint64 latestStartTime, uint64[] terms, uint32[] percentages, bool isValid), uint256 tokenId, uint256 vestingAmount))',
  'function balanceOf(address owner) view returns (uint256)',
  'function tokenOfOwnerByIndex(address owner,uint256 index) view returns (uint256)'
];

export async function strategy(
  space,
  network,
  provider,
  addresses,
  options,
  snapshot
) {
  const blockTag = typeof snapshot === 'number' ? snapshot : 'latest';

  // flexible voucher banlanceOf
  const callWalletToCrucibleCount = new Multicaller(network, provider, abi, {
    blockTag
  });
  for (const walletAddress of addresses) {
    callWalletToCrucibleCount.call(
      walletAddress,
      options.address,
      'balanceOf',
      [walletAddress]
    );
  }

  // wallet Owner Index
  const walletToCrucibleCount: Record<string, BigNumber> =
    await callWalletToCrucibleCount.execute();

  const callWalletToCrucibleAddresses = new Multicaller(
    network,
    provider,
    abi,
    {
      blockTag
    }
  );
  for (const [walletAddress, crucibleCount] of Object.entries(
    walletToCrucibleCount
  )) {
    for (let index = 0; index < crucibleCount.toNumber(); index++) {
      callWalletToCrucibleAddresses.call(
        walletAddress.toString() + '-' + index.toString(),
        options.address,
        'tokenOfOwnerByIndex',
        [walletAddress, index]
      );
    }
  }
  const walletIDToCrucibleAddresses: Record<string, BigNumber> =
    await callWalletToCrucibleAddresses.execute();

  // voucher snapshot
  const callCrucibleToSnapshot = new Multicaller(network, provider, abi, {
    blockTag
  });
  // walletID: walletAddress-index
  for (const [walletID, crucibleAddress] of Object.entries(
    walletIDToCrucibleAddresses
  )) {
    callCrucibleToSnapshot.call(walletID, options.address, 'getSnapshot', [
      hexZeroPad(crucibleAddress.toHexString(), 20)
    ]);
  }
  const walletIDToSnapshot: Record<
    string,
    Array<any>
  > = await callCrucibleToSnapshot.execute();

  const walletToWeights = {} as Record<string, number>;
  for (const [walletID, snapshot] of Object.entries(walletIDToSnapshot)) {
    const address = walletID.split('-')[0];
    const value =
      parseFloat(formatUnits(snapshot[2].toString(), options.decimals)) *
      claimCoefficient(snapshot[0][1]) *
      maturitiesCoefficient(
        snapshot[0][2] == 0 ? snapshot[0][3] : snapshot[0][2],
        snapshot[0][4]
      );
    walletToWeights[address] = walletToWeights[address]
      ? walletToWeights[address] + value
      : value;
  }

  return Object.fromEntries(
    Object.entries(walletToWeights).map(([address, balance]) => [
      address,
      balance
    ])
  );
}
