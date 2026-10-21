import type { InstrumentKind } from "./types";

export interface BstockSeedRow {
  symbol: string;
  name: string;
  address: string;
  ticker: string;
  /** Desk lane from the 2026-10-08 capture. The volume seed itself marks every row equity. */
  kind: InstrumentKind;
}

/**
 * bStocks contracts from `BSTOCKS_SEED` in `scripts/bnb_volume_universe.py`.
 * Jumper's catalog (`rwa.jumper.xyz/providers/bstocks`) answered 403 on 2026-10-20,
 * and the live BNB registry then omitted this issuer. The holder capture unions
 * this list when that happens. Prices still come from DexScreener. A row with
 * no pool price stays null.
 */
export const BSTOCKS_SEED: readonly BstockSeedRow[] = [
  {
    "symbol": "SPCXB",
    "name": "SpaceX",
    "address": "0xbe9D156892E55e7154BcD3cB0FEA677F9D3103E1",
    "ticker": "SPCX",
    "kind": "private"
  },
  {
    "symbol": "LLYB",
    "name": "Eli Lilly",
    "address": "0x5407912F1Aa4B9E05cBE6aBeb9721547a643eC6b",
    "ticker": "LLY",
    "kind": "equity"
  },
  {
    "symbol": "PDDB",
    "name": "PDD Holdings Inc",
    "address": "0x95b0409679B55C31772daA2fB4bEE7B125B77521",
    "ticker": "PDD",
    "kind": "equity"
  },
  {
    "symbol": "WENB",
    "name": "Wendy's",
    "address": "0xDed1c5FB38C262beb9CfF1E1116EfF3c5bf278Cd",
    "ticker": "WEN",
    "kind": "equity"
  },
  {
    "symbol": "RDDTB",
    "name": "Reddit",
    "address": "0x41622a9125A22767Df8C1dC79FC17299BAc4Bd0b",
    "ticker": "RDDT",
    "kind": "equity"
  },
  {
    "symbol": "ADBEB",
    "name": "Adobe",
    "address": "0x65c0249d49E3231540Fd0db0a1ae9259e6eAaf57",
    "ticker": "ADBE",
    "kind": "equity"
  },
  {
    "symbol": "JPMB",
    "name": "JPMorgan Chase",
    "address": "0xbd49D695ba2cc46c8C603eb62aFcd7Fff4698281",
    "ticker": "JPM",
    "kind": "equity"
  },
  {
    "symbol": "CRMB",
    "name": "Salesforce",
    "address": "0x8C433eCa1be0e2a357015602F63751C768F6f643",
    "ticker": "CRM",
    "kind": "equity"
  },
  {
    "symbol": "CRWDB",
    "name": "CrowdStrike",
    "address": "0x814981CF5df4a14D4D7328f9ABf0d02e9ED54CD1",
    "ticker": "CRWD",
    "kind": "equity"
  },
  {
    "symbol": "AMATB",
    "name": "Applied Materials",
    "address": "0xa304bd78e739c0f777202b3eb73ac3736d1df801",
    "ticker": "AMAT",
    "kind": "equity"
  },
  {
    "symbol": "COHRB",
    "name": "Coherent",
    "address": "0x5131859a059b2446abeefe0f5d313b3c54ff3d36",
    "ticker": "COHR",
    "kind": "equity"
  },
  {
    "symbol": "DELLB",
    "name": "Dell Technologies",
    "address": "0x0e7a51966c66648999d506e1372efdea1b78cb0b",
    "ticker": "DELL",
    "kind": "equity"
  },
  {
    "symbol": "PYPLB",
    "name": "PayPal",
    "address": "0x2806a561fc1f9259b2d54a281796bde0d92762ae",
    "ticker": "PYPL",
    "kind": "equity"
  },
  {
    "symbol": "AAOIB",
    "name": "Applied Optoelectronics",
    "address": "0x10343ef7da3301493d7ecb647d68a288c6c1db2f",
    "ticker": "AAOI",
    "kind": "equity"
  },
  {
    "symbol": "AAPLB",
    "name": "Apple",
    "address": "0x431a3bee82e2ca41e49895cbece5bb0f76a89b7a",
    "ticker": "AAPL",
    "kind": "equity"
  },
  {
    "symbol": "ALABB",
    "name": "Astera Labs",
    "address": "0x1282493ede6a22753d45cb2c0fdbd8d35e97555a",
    "ticker": "ALAB",
    "kind": "equity"
  },
  {
    "symbol": "AMDB",
    "name": "Advanced Micro Devices Inc",
    "address": "0x75fd4cf6f8392e41e70391d60c90c0d5211603a1",
    "ticker": "AMD",
    "kind": "equity"
  },
  {
    "symbol": "AMZNB",
    "name": "Amazon",
    "address": "0x1a4b499833a79a09ad7cf1d42d7dacf71e92eb00",
    "ticker": "AMZN",
    "kind": "equity"
  },
  {
    "symbol": "ARMB",
    "name": "Arm Holdings",
    "address": "0xd42a79ebb7f527f40faecd196ffb47ad5e8d6f8c",
    "ticker": "ARM",
    "kind": "equity"
  },
  {
    "symbol": "ASMLB",
    "name": "ASML",
    "address": "0xfbfb4f79cfb4c34dcd7c82bdee5a0fa199b2e7f9",
    "ticker": "ASML",
    "kind": "equity"
  },
  {
    "symbol": "ASTSB",
    "name": "AST SpaceMobile",
    "address": "0x58b6f5feeb8436489f5bf4a56619092b1fa8e777",
    "ticker": "ASTS",
    "kind": "equity"
  },
  {
    "symbol": "AVGOB",
    "name": "Broadcom",
    "address": "0x76682c454467b3a1150ad8b6a92fc5ee2c21d7ed",
    "ticker": "AVGO",
    "kind": "equity"
  },
  {
    "symbol": "AXTIB",
    "name": "AXT",
    "address": "0x9bdc8b470dbf89dbcb123587c6f5e49cca3463be",
    "ticker": "AXTI",
    "kind": "equity"
  },
  {
    "symbol": "BABAB",
    "name": "Alibaba",
    "address": "0x4ef9d3062c7f6eba4aae4990c5036598c6eff4ec",
    "ticker": "BABA",
    "kind": "equity"
  },
  {
    "symbol": "BEB",
    "name": "Bloom Energy",
    "address": "0x5519de00f5388c17d886b97cb5d2d43a812a82bc",
    "ticker": "BE",
    "kind": "equity"
  },
  {
    "symbol": "BMNRB",
    "name": "BitMine Immersion Technologies",
    "address": "0x3548da95a9effe481e8604664d75e95821e557f5",
    "ticker": "BMNR",
    "kind": "equity"
  },
  {
    "symbol": "BNCB",
    "name": "CEA Industries",
    "address": "0x4902C5ebc598265Ed2212b559B042De8a5Eeec3f",
    "ticker": "BNC",
    "kind": "equity"
  },
  {
    "symbol": "CBRSB",
    "name": "Cerebras",
    "address": "0xe81c6bb0266cd68b4f17278531dd03ea1f12da4e",
    "ticker": "CBRS",
    "kind": "equity"
  },
  {
    "symbol": "COINB",
    "name": "Coinbase",
    "address": "0x585bde7c54abb5ccd7791f923d6c2187635f3952",
    "ticker": "COIN",
    "kind": "equity"
  },
  {
    "symbol": "CRCLB",
    "name": "Circle Internet Group Inc.",
    "address": "0x80f3d493ebce97e343c53d29a137942416b4ffc0",
    "ticker": "CRCL",
    "kind": "equity"
  },
  {
    "symbol": "CRDOB",
    "name": "Credo Technology",
    "address": "0x6e7d451f9d30327d32020f116fa79c23b24e9c8d",
    "ticker": "CRDO",
    "kind": "equity"
  },
  {
    "symbol": "CRWVB",
    "name": "CoreWeave",
    "address": "0x33e7317e17838fee56b10fe8d0b9ca6ca3090c95",
    "ticker": "CRWV",
    "kind": "equity"
  },
  {
    "symbol": "DJTB",
    "name": "Trump Media & Technology Group Corp",
    "address": "0xf2ec508422174ee564de98187db9359d318afb6b",
    "ticker": "DJT",
    "kind": "equity"
  },
  {
    "symbol": "DRAMB",
    "name": "Roundhill Memory ETF",
    "address": "0x93862d63fd9fd488b1328e9b47717d75e994a84b",
    "ticker": "DRAM",
    "kind": "etf"
  },
  {
    "symbol": "EWYB",
    "name": "iShares MSCI South Korea ETF",
    "address": "0xbe82f76637dba2c114c41df856c2c51e522e2cb8",
    "ticker": "EWY",
    "kind": "etf"
  },
  {
    "symbol": "FLNCB",
    "name": "Fluence Energy",
    "address": "0x4af1d41cd9dd950dca43984b43aaa2a8702714ac",
    "ticker": "FLNC",
    "kind": "equity"
  },
  {
    "symbol": "GLWB",
    "name": "Corning",
    "address": "0x740e075cbbea22a082b9d6679e65e82767875b6a",
    "ticker": "GLW",
    "kind": "equity"
  },
  {
    "symbol": "GMEB",
    "name": "GameStop",
    "address": "0x46ceefda28dd7207059ed19b0acdc026955bb15c",
    "ticker": "GME",
    "kind": "equity"
  },
  {
    "symbol": "GOOGLB",
    "name": "Alphabet",
    "address": "0x3f53de71c126bdabae20f9cd64848d317f6c3238",
    "ticker": "GOOGL",
    "kind": "equity"
  },
  {
    "symbol": "GSB",
    "name": "Goldman Sachs",
    "address": "0x20cce6656e5f7f79f280e2d0f5db55b401bdbfce",
    "ticker": "GS",
    "kind": "equity"
  },
  {
    "symbol": "HOODB",
    "name": "Robinhood",
    "address": "0xa394dcea3fd3847fd793afbfd163e2e3858b7c65",
    "ticker": "HOOD",
    "kind": "equity"
  },
  {
    "symbol": "IBMB",
    "name": "IBM",
    "address": "0xfa273b076feb8c0fb34e554ae341082323d016a3",
    "ticker": "IBM",
    "kind": "equity"
  },
  {
    "symbol": "INTCB",
    "name": "Intel Corporation",
    "address": "0xe614e2fc6c787035ff51f452e8e826bfd32d5283",
    "ticker": "INTC",
    "kind": "equity"
  },
  {
    "symbol": "IRENB",
    "name": "IREN",
    "address": "0xfdc2f2cab77b28f7ef6c819a404706cfa9bca33b",
    "ticker": "IREN",
    "kind": "equity"
  },
  {
    "symbol": "LITEB",
    "name": "Lumentum Holdings",
    "address": "0x64748bea17b6d19e242adf20425de2440c656142",
    "ticker": "LITE",
    "kind": "equity"
  },
  {
    "symbol": "METAB",
    "name": "Meta Platforms",
    "address": "0x7425889fe94f9d693e8daefe88bcced6acfef4c0",
    "ticker": "META",
    "kind": "equity"
  },
  {
    "symbol": "MRVLB",
    "name": "Marvell Technology",
    "address": "0x16cd4fe7e8880ecc3ba222795229e20489fc2c76",
    "ticker": "MRVL",
    "kind": "equity"
  },
  {
    "symbol": "MSFTB",
    "name": "Microsoft",
    "address": "0x80106cb3ead06659a5ad19df39d9b4733863b9b0",
    "ticker": "MSFT",
    "kind": "equity"
  },
  {
    "symbol": "MSTRB",
    "name": "Strategy Inc.",
    "address": "0xe87afb3076aeb0f9b14e368de8145ae6a2826a14",
    "ticker": "MSTR",
    "kind": "equity"
  },
  {
    "symbol": "MUB",
    "name": "Micron Technology Inc",
    "address": "0xcdf2f3e0fa43c47a6662a91c9e4a7c5f69762699",
    "ticker": "MU",
    "kind": "equity"
  },
  {
    "symbol": "NBISB",
    "name": "Nebius",
    "address": "0xe256bc2a4f5297f8ba6f043f180a46300ecbcbb1",
    "ticker": "NBIS",
    "kind": "equity"
  },
  {
    "symbol": "NFLXB",
    "name": "Netflix",
    "address": "0xd6829ea836b6fa224d099d40e54b31262f874631",
    "ticker": "NFLX",
    "kind": "equity"
  },
  {
    "symbol": "NOKB",
    "name": "Nokia",
    "address": "0x7c4d7a180d737dd5a70d8065a90e6746a69c37ea",
    "ticker": "NOK",
    "kind": "equity"
  },
  {
    "symbol": "NVDAB",
    "name": "NVIDIA Corp",
    "address": "0x02fca66c1d1afb4e2a7884261eb00f63598a7436",
    "ticker": "NVDA",
    "kind": "equity"
  },
  {
    "symbol": "ORCLB",
    "name": "Oracle",
    "address": "0x4684d9887fc1c71cba7bab8e88835cec217eb598",
    "ticker": "ORCL",
    "kind": "equity"
  },
  {
    "symbol": "PLTRB",
    "name": "Palantir Technologies",
    "address": "0x0ca5d51d0277bd006fd9607d3e560785ebad8222",
    "ticker": "PLTR",
    "kind": "equity"
  },
  {
    "symbol": "QCOMB",
    "name": "Qualcomm",
    "address": "0x5f7a56e877b9130608bf8be962621011182fefe1",
    "ticker": "QCOM",
    "kind": "equity"
  },
  {
    "symbol": "QNTB",
    "name": "Quantinuum",
    "address": "0xd721c192d612db77621df57a9fab38418033c02e",
    "ticker": "QNT",
    "kind": "equity"
  },
  {
    "symbol": "QQQB",
    "name": "Invesco QQQ",
    "address": "0x205812cdbed920aff76c6580abd681a46d11efc7",
    "ticker": "QQQ",
    "kind": "etf"
  },
  {
    "symbol": "RKLBB",
    "name": "Rocket Lab",
    "address": "0xc8da12cbcce7c45180692a6420b0076e03a5179a",
    "ticker": "RKLB",
    "kind": "equity"
  },
  {
    "symbol": "SKHYB",
    "name": "SK Hynix",
    "address": "0xca750ef65f295bbecd685abf54e82caf297bdb61",
    "ticker": "SKHY",
    "kind": "equity"
  },
  {
    "symbol": "SMCIB",
    "name": "Super Micro Computer",
    "address": "0x387dea1d2772d716d081a29116f3effa0ffe1f36",
    "ticker": "SMCI",
    "kind": "equity"
  },
  {
    "symbol": "SMHB",
    "name": "VanEck Semiconductor ETF",
    "address": "0xbe1fced7047fdce935f45700727845df2c76877a",
    "ticker": "SMH",
    "kind": "etf"
  },
  {
    "symbol": "SNDKB",
    "name": "Sandisk Corporation",
    "address": "0x3ee4df61bd4f867e349beae8bfe07bc31b4850fb",
    "ticker": "SNDK",
    "kind": "equity"
  },
  {
    "symbol": "SPYB",
    "name": "SPDR S&P 500 ETF",
    "address": "0x7138b48df7d98d7e3cc221bfe7192d0a178182d8",
    "ticker": "SPY",
    "kind": "etf"
  },
  {
    "symbol": "TSLAB",
    "name": "Tesla, Inc.",
    "address": "0x5b1910eaad6450e50f816082aa078c41f10c292f",
    "ticker": "TSLA",
    "kind": "equity"
  },
  {
    "symbol": "TSMB",
    "name": "TSMC",
    "address": "0xab78b89b5bb00236be0b4b20704cbfa04efc711c",
    "ticker": "TSM",
    "kind": "equity"
  },
  {
    "symbol": "USARB",
    "name": "USA Rare Earth",
    "address": "0xcd345d4450e04cdef422a60b97d9265d24e0bcee",
    "ticker": "USAR",
    "kind": "equity"
  },
  {
    "symbol": "WDCB",
    "name": "Western Digital",
    "address": "0xebe29695f8047c13d36e7a790ca8c1b239ffad1c",
    "ticker": "WDC",
    "kind": "equity"
  }
];
