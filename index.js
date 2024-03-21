import { calculate_liquidity_out } from "@galacticcouncil/math-omnipool";
import { ApiPromise, WsProvider } from "@polkadot/api";
import BigNumber from "bignumber.js";
import fs from "fs";

const DECIMALS = 10;
const DOT_ID = 5;
const VDOT_ID = 15;
const OMNIPOOL_COLLECTION_ID = 1337;
const OMNIPOOL_ADDRESS = "7L53bUTBbfuj14UpdCNPwmgzzHSsrsTWBHX5pys32mVWM3C1";
const TREASURY_ADDRESS = "7L53bUTBopuwFt3mKUfmkzgGLayYa1Yvn1hAg9v5UMrQzTfh";

const rpc = "wss://rpc.hydradx.cloud";
const block = parseInt(process.argv[2]);

async function main() {
  if (Number.isInteger(block) && block > 0) {
    console.log("fetching holders for block " + block);
  } else {
    console.log(
      "please specify a block number after the command (e.g. node index.js 4700000)"
    );
    process.exit(1);
  }

  fs.mkdirSync("data", { recursive: true });

  console.log("connecting to " + rpc);
  const wsProvider = new WsProvider(rpc);
  const api = await ApiPromise.create({ provider: wsProvider });
  const currentBlock = (await api.rpc.chain.getBlock()).block.header.number;
  const blockHash = await api.rpc.chain.getBlockHash(block);
  const apiAt = await api.at(blockHash);
  console.log(
    `connected, #${currentBlock} fetching token holders at #${block}...`
  );

  // Yield DCA
  const schedules = await apiAt.query.dca.schedules.entries();
  const uniqueAccounts = {};

  const vdotSchedules = schedules
    .filter((schedule) => {
      if (
        schedule[1].toJSON().order.sell &&
        schedule[1].toJSON().order.sell.assetIn === 15
      ) {
        uniqueAccounts[schedule[1].toJSON().owner] = true;
        return true;
      } else return false;
    })
    .map((schedule) => {
      return {
        [schedule[1].toJSON().owner]: BigNumber(
          schedule[1].toJSON().totalAmount
        )
          .dividedBy(10 ** DECIMALS)
          .toString(), // VDOT
      };
    });

  console.log(
    Object.keys(uniqueAccounts).length,
    "unique accounts scheduled",
    vdotSchedules.length,
    "vdot yield dca schedules"
  );
  console.log(
    'writing $[account]: [total vDOT] to "vdot-yield-schedules.json"'
  );
  fs.writeFileSync(
    "data/vdot-yield-schedules.json",
    JSON.stringify(vdotSchedules, 2, 2)
  );

  // Token holders
  const tokenHolders = await apiAt.query.tokens.accounts.entries();
  console.log(tokenHolders.length, "token entries");
  const dotHolders = tokenHolders
    .filter((holder) => parseInt(holder[0].toHuman()[1]) === DOT_ID)
    .map(mapHolders);
  console.log(dotHolders.length, " dot holders");
  console.log("writing dot-holders.json");
  fs.writeFileSync("data/dot-holders.json", JSON.stringify(dotHolders, 2, 2));

  const vdotHolders = tokenHolders
    .filter((holder) => parseInt(holder[0].toHuman()[1]) === VDOT_ID)
    .map(mapHolders);
  console.log(vdotHolders.length, " vdot holders");
  console.log("writing vdot-holders.json");
  fs.writeFileSync("data/vdot-holders.json", JSON.stringify(vdotHolders, 2, 2));

  // LPs
  const omnipoolDotData = (await apiAt.query.omnipool.assets(DOT_ID)).toJSON();
  const omnipoolVdotData = (
    await apiAt.query.omnipool.assets(VDOT_ID)
  ).toJSON();

  const omnipoolDot = (
    await apiAt.query.tokens.accounts(OMNIPOOL_ADDRESS, DOT_ID)
  ).free;
  const omnipoolVdot = (
    await apiAt.query.tokens.accounts(OMNIPOOL_ADDRESS, VDOT_ID)
  ).free;

  const positions = await apiAt.query.omnipool.positions.entries();
  console.log("found", positions.length, "positions in the omnipool");

  const positionOwners = {};
  (await apiAt.query.uniques.asset.entries(OMNIPOOL_COLLECTION_ID)).forEach(
    (owner) => {
      positionOwners[owner[0].toHuman()[1]] = owner[1].toHuman().owner;
    }
  );

  const dotPositions = positions
    .filter((position) => {
      return position[1].toJSON().assetId === DOT_ID;
    })
    .map((position) => {
      return mapPositions(
        position,
        positionOwners[position[0].toHuman()[0]],
        omnipoolDotData,
        omnipoolDot
      );
    });
  console.log(
    BigNumber(omnipoolDot)
      .dividedBy(10 ** DECIMALS)
      .toString(),
    "DOT locked in",
    dotPositions.length,
    "dot positions"
  );
  console.log("writing dot-positions.json");
  fs.writeFileSync(
    "data/dot-positions.json",
    JSON.stringify(dotPositions, 2, 2)
  );

  const vdotPositions = positions
    .filter((position) => {
      return position[1].toJSON().assetId === VDOT_ID;
    })
    .map((position) => {
      return mapPositions(
        position,
        positionOwners[position[0].toHuman()[0]],
        omnipoolVdotData,
        omnipoolVdot
      );
    });
  console.log(
    BigNumber(omnipoolVdot)
      .dividedBy(10 ** DECIMALS)
      .toString(),
    "vDOT locked in",
    vdotPositions.length,
    "vdot positions"
  );
  console.log("writing vdot-positions.json");
  fs.writeFileSync(
    "data/vdot-positions.json",
    JSON.stringify(vdotPositions, 2, 2)
  );

  console.log(
    "All DOT / vDOT balances are formatted to 10 decimal places",
    "\nKindly please send all unallocated funds to the Treasury",
    TREASURY_ADDRESS,
    "\ndone!"
  );

  process.exit(0);
}

function mapPositions(position, positionOwner, assetData, assetReserve) {
  const positionData = position[1].toJSON();

  return {
    id: position[0].toHuman()[0],
    owner: positionOwner,
    originalAmount: positionData.amount,
    shares: positionData.shares,
    originalPrice: positionData.price,
    underlyingAmount: BigNumber(
      calculate_liquidity_out(
        BigInt(assetReserve).toString(),
        BigInt(assetData.hubReserve).toString(),
        BigInt(assetData.shares).toString(),
        BigInt(positionData.amount).toString(),
        BigInt(positionData.shares).toString(),
        BigNumber(positionData.price[0])
          .dividedBy(positionData.price[1])
          .multipliedBy(10 ** 18)
          .toFixed(0)
          .toString(),
        BigInt(positionData.shares).toString(),
        "0"
      )
    )
      .dividedBy(10 ** DECIMALS)
      .toString(),
  };
}

function mapHolders(tokenHolder) {
  return {
    address: tokenHolder[0].toHuman()[0],
    freeBalance: BigNumber(tokenHolder[1].free)
      .dividedBy(10 ** DECIMALS)
      .toString(), // Yield DCA
    reservedBalance: BigNumber(tokenHolder[1].reserved)
      .dividedBy(10 ** DECIMALS)
      .toString(), // Yield DCA
    totalBalance: BigNumber(tokenHolder[1].free)
      .plus(BigNumber(tokenHolder[1].reserved))
      .dividedBy(10 ** DECIMALS)
      .toString(), // Yield DCA
  };
}

main();
