import { ethers } from "ethers";
import { Mainnet, NetworkType } from "mainnet-js";

export let defaultServers = {
  EthMainnet: ["https://mainnet.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161"],
  mainnet: [
    "https://smartbch.fountainhead.cash/mainnet",
    "https://smartbch.greyh.at",
  ],
  testnet: ["http://35.220.203.194:8545", "https://moeing.tech:9545"],
  regtest: ["http://127.0.0.1:8545"],
};

export function getNetworkProvider(
  network: NetworkType = NetworkType.Mainnet
): ethers.providers.BaseProvider {
  let url = defaultServers[network][0] || "";
  if (Mainnet.getRuntimePlatform() === Mainnet.RuntimePlatform.browser) {
    url =
      defaultServers[network].filter(
        (val) => val.indexOf("https://") === 0
      )[0] || url;
  }
  switch (network as any) {
    case "EthMainnet": {
      return new ethers.providers.JsonRpcProvider(url);
    }
    case NetworkType.Mainnet: {
      // return new ethers.providers.WebSocketProvider(
      //   "wss://smartbch-wss.greyh.at",
      //   { name: "smartbch", chainId: 10000 }
      // );
      return new ethers.providers.JsonRpcProvider(url, {
        name: "smartbch",
        chainId: 10000,
      });
    }
    case NetworkType.Testnet: {
      return new ethers.providers.JsonRpcProvider(url, {
        name: "smartbch",
        chainId: 10001,
      });
    }
    default: {
      return new ethers.providers.StaticJsonRpcProvider(url, {
        name: "smartbch",
        chainId: 10002,
      });
    }
  }
}
