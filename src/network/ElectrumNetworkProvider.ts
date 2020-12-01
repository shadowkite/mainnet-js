import {
  ElectrumCluster,
  ElectrumClient,
  RequestResponse,
  ConnectionStatus,
} from "electrum-cash";
import { NetworkProvider } from "cashscript";
import { Tx, UtxoI, ElectrumBalanceI } from "../interface";
import { Network } from "../interface";
import { delay } from "../util/delay";

export default class ElectrumNetworkProvider implements NetworkProvider {
  public electrum: ElectrumCluster | ElectrumClient;
  public concurrentRequests: number = 0;

  constructor(
    electrum: ElectrumCluster | ElectrumClient,
    public network: Network = Network.MAINNET,
    private manualConnectionManagement?: boolean
  ) {
    if (electrum) {
      this.electrum = electrum;
      return;
    } else {
      throw new Error(`A electrum-cash cluster or client is required.`);
    }
  }

  async getUtxos(address: string): Promise<UtxoI[]> {
    const result = (await this.performRequest(
      "blockchain.address.listunspent",
      address
    )) as ElectrumUtxo[];

    const utxos = result.map((utxo) => ({
      txid: utxo.tx_hash,
      vout: utxo.tx_pos,
      satoshis: utxo.value,
      height: utxo.height,
    }));

    return utxos;
  }

  async getBalance(address: string): Promise<number> {
    const result = (await this.performRequest(
      "blockchain.address.get_balance",
      address
    )) as ElectrumBalanceI;

    return result.confirmed + result.unconfirmed;
  }

  async getBlockHeight(): Promise<number> {
    const { height } = (await this.performRequest(
      "blockchain.headers.subscribe"
    )) as BlockHeader;

    return height;
  }

  async getRawTransaction(txid: string, verbose: boolean = false): Promise<string> {
    return (await this.performRequest(
      "blockchain.transaction.get",
      txid,
      verbose
    )) as string;
  }

  async getRawTransactionObject(txid: string): Promise<any> {
    return (await this.performRequest(
      "blockchain.transaction.get",
      txid,
      true
    )) as Object;
  }

  async sendRawTransaction(txHex: string): Promise<string> {
    let result = (await this.performRequest(
      "blockchain.transaction.broadcast",
      txHex
    )) as string;

    // This assumes the fulcrum server is configured with a 0.5s delay
    await delay(1050);
    return result;
  }

  async getHistory(address: string): Promise<Tx[]> {
    const result = (await this.performRequest(
      "blockchain.address.get_history",
      address
    )) as Tx[];

    return result;
  }

  async subscribeToAddress(address: string, callback: (data: any) => void): Promise<void> {
    await this.subscribeRequest(
      "blockchain.address.subscribe",
      callback,
      address
    );
  }


  async unsubscribeFromAddress(address: string, callback: (data: any) => void): Promise<void> {
    await this.unsubscribeRequest(
      "blockchain.address.subscribe",
      callback,
      address
    );
  }

  private async performRequest(
    name: string,
    ...parameters: (string | number | boolean)[]
  ): Promise<RequestResponse> {
    // Only connect the cluster when no concurrent requests are running
    if (this.shouldConnect()) {
      await this.connect();
      this.concurrentRequests += 1;
    }

    await this.ready();

    let result;
    try {
      result = await this.electrum.request(name, ...parameters);
    } finally {
      // Always disconnect the cluster, also if the request fails
      if (this.shouldDisconnect()) {
        await this.disconnect();
        this.concurrentRequests -= 1;
      }
    }

    if (result instanceof Error) throw result;

    return result;
  }

  private async subscribeRequest(
    methodName: string,
    callback: (data) => void,
    ...parameters: (string | number | boolean)[]
  ): Promise<true> {
    // Only connect the cluster when no concurrent requests are running
    if (this.shouldConnect()) {
      await this.connect();
      this.concurrentRequests += 1;
    }

    await this.ready();

    let result;
    try {
      result = await this.electrum.subscribe(callback, methodName, ...parameters);
    } finally {
      // Always disconnect the cluster, also if the request fails
      if (this.shouldDisconnect()) {
        await this.disconnect();
        this.concurrentRequests -= 1;
      }
    }

    if (result instanceof Error) throw result;

    return result;
  }

  private async unsubscribeRequest(
    methodName: string,
    callback: (data) => void,
    ...parameters: (string | number | boolean)[]
  ): Promise<true> {
    // Only connect the cluster when no concurrent requests are running
    if (this.shouldConnect()) {
      await this.connect();
      this.concurrentRequests += 1;
    }

    await this.ready();

    let result;
    try {
      result = await this.electrum.unsubscribe(callback, methodName, ...parameters);
    } finally {
      // Always disconnect the cluster, also if the request fails
      if (this.shouldDisconnect()) {
        await this.disconnect();
        this.concurrentRequests -= 1;
      }
    }

    if (result instanceof Error) throw result;

    return result;
  }

  private shouldConnect(): boolean {
    if (this.manualConnectionManagement) return false;
    if (this.concurrentRequests !== 0) return false;
    return true;
  }

  private shouldDisconnect(): boolean {
    if (this.manualConnectionManagement) return false;
    if (this.concurrentRequests !== 1) return false;
    return true;
  }

  async ready(): Promise<boolean | unknown> {
    return this.isElectrumClient() ? this.readyClient() : this.readyCluster();
  }

  connect(): Promise<void[]> {
    return this.isElectrumClient()
      ? this.connectClient()
      : this.connectCluster();
  }
  disconnect(): Promise<boolean[]> {
    return this.isElectrumClient()
      ? this.disconnectClient()
      : this.disconnectCluster();
  }

  isElectrumClient(): boolean {
    return this.electrum.hasOwnProperty("connection");
  }

  async readyClient(timeout?: number): Promise<boolean | unknown> {
    timeout = typeof timeout !== "undefined" ? timeout : 3000;

    let connectPromise = async () => {
      while (
        (this.electrum as ElectrumClient).connection.status !==
        ConnectionStatus.CONNECTED
      ) {
        await delay(100);
      }
      return true;
    };

    // @ts-ignore
    let timeoutPromise = new Promise((resolve, reject) => {
      let id = setTimeout(() => {
        clearTimeout(id);
        reject(`Client Connection Request timeout after ${timeout}ms`);
      }, timeout);
    });

    return Promise.race([connectPromise(), timeoutPromise]);
  }

  async readyCluster(timeout?: number): Promise<boolean | unknown> {
    timeout = typeof timeout !== "undefined" ? timeout : 3000;

    // @ts-ignore
    let timeoutPromise = new Promise((none, reject) => {
      let id = setTimeout(() => {
        clearTimeout(id);
        reject(`Cluster connection request timeout after ${timeout}`);
      }, timeout);
    });

    // Race the call to connect with an error
    return Promise.race([
      (this.electrum as ElectrumCluster).ready(),
      timeoutPromise,
    ]);
  }

  async connectCluster(): Promise<void[]> {
    try {
      return (this.electrum as ElectrumCluster).startup();
    } catch (e) {
      throw Error(e);
    }
  }

  async connectClient(): Promise<void[]> {
    try {
      return [await (this.electrum as ElectrumClient).connect()];
    } catch (e) {
      throw Error(e);
    }
  }

  async disconnectCluster(): Promise<boolean[]> {
    return (this.electrum as ElectrumCluster).shutdown();
  }

  async disconnectClient(): Promise<boolean[]> {
    return [await (this.electrum as ElectrumClient).disconnect(true)];
  }
}

interface ElectrumUtxo {
  tx_pos: number;
  value: number;
  tx_hash: string;
  height: number;
}

interface BlockHeader {
  height: number;
  hex: string;
}
