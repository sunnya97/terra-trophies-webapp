import { LCDClient, MsgExecuteContract, TreasuryAPI } from "@terra-money/terra.js";
import {
  ConnectType,
  CreateTxFailed,
  getChainOptions,
  Timeout,
  TxFailed,
  TxResult,
  TxUnspecifiedError,
  UserDenied,
  WalletController,
  WalletStatus,
} from "@terra-money/wallet-provider";

import * as secp256k1 from "secp256k1";
import { SHA256 } from "jscrypto/SHA256";

import "bootstrap";
import "bootstrap/dist/css/bootstrap.min.css";

type Trait = {
  display_type?: string;
  trait_type: string;
  value: string;
};

type Metadata = {
  image?: string;
  image_data?: string;
  external_url?: string;
  description?: string;
  name?: string;
  attributes?: Trait[];
  background_color?: string;
  animation_url?: string;
  youtube_url?: string;
};

const HUB_ADDRESS = {
  mainnet: "terra14grqjgxfpd7llmrnd5z5ddd8h6p5awxzu3qngy",
  testnet: "terra1dj64fnuw95dl30fm6y4xp80zvgfcsth0cq07rf",
};

// HTML elements
const walletConnectContainer = document.getElementById("walletConnectContainer") as HTMLElement;
const walletStatusContainer = document.getElementById("walletStatusContainer") as HTMLElement;

const connectExtensionButton = document.getElementById("connectExtensionButton") as HTMLElement;
const connectMobileButton = document.getElementById("connectMobileButton") as HTMLElement;
const disconnectButton = document.getElementById("disconnectButton") as HTMLElement;

const walletNetworkSpan = document.getElementById("walletNetwork") as HTMLElement;
const walletAddressSpan = document.getElementById("walletAddress") as HTMLElement;

const createSelector = document.getElementById("createSelector") as HTMLElement;
const claimSelector = document.getElementById("claimSelector") as HTMLElement;
const gallerySelector = document.getElementById("gallerySelector") as HTMLElement;

const createContainer = document.getElementById("createContainer") as HTMLElement;
const claimContainer = document.getElementById("claimContainer") as HTMLElement;
const galleryContainer = document.getElementById("galleryContainer") as HTMLElement;

const trophyNameSpan = document.getElementById("trophyName") as HTMLElement;
const trophyDescriptionSpan = document.getElementById("trophyDescription") as HTMLElement;
const trophyImage = document.getElementById("trophyImage") as HTMLImageElement;

const submitTxButton = document.getElementById("submitTxButton") as HTMLElement;
const txResult = document.getElementById("txResult") as HTMLElement;

// parse query string
const urlSearchParams = new URLSearchParams(window.location.search);
const params = Object.fromEntries(urlSearchParams.entries());

if (!("trophyId" in params)) {
  alert("ERROR: Trophy ID not provided!");
}
if (!("secretKey" in params)) {
  alert("ERROR: Secret key not provided!");
}

const trophyId = parseInt(params.trophyId);
const secretKey = params.secretKey;
console.log("trophyId:", trophyId);
console.log("secretKey:", secretKey);

// convert an IPFS URL to Pinate Gateway URL
function ipfsToPinataGateway(url: string | undefined) {
  const placeholder = "https://via.placeholder.com/500?text=image+unavailable";
  // if image URL is not available - use placeholder
  // if image is not on IPFS - use placeholder
  if (!url || !url.startsWith("ipfs://")) {
    console.log("image url not provided or is not on IPFS. use placeholder");
    return placeholder;
  }
  // if image is on IPFS - convert to Pinata Gateway
  const hash = url.slice(7);
  return `https://gateway.pinata.cloud/ipfs/${hash}`;
}

// address into this format: terra1234...abcd
function shortenAddress(addr: string) {
  const len = addr.length;
  return addr.slice(0, 9) + "&hellip;" + addr.slice(len - 4, len);
}

// encodes a u8 array into base64 string
function bytesToBase64(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("base64");
}

// decodes a base64 string to u8 array
function base64ToBytes(base64: string) {
  return new Uint8Array(Buffer.from(base64, "base64"));
}

// selector actions
createSelector.addEventListener("click", () => {
  console.log("switching to create tab");
  createSelector.classList.remove("selector-deactivated");
  claimSelector.classList.add("selector-deactivated");
  gallerySelector.classList.add("selector-deactivated");
  createContainer.style.display = "block";
  claimContainer.style.display = "none";
  galleryContainer.style.display = "none";
});
claimSelector.addEventListener("click", () => {
  console.log("switching to claim tab");
  createSelector.classList.add("selector-deactivated");
  claimSelector.classList.remove("selector-deactivated");
  gallerySelector.classList.add("selector-deactivated");
  createContainer.style.display = "none";
  claimContainer.style.display = "block";
  galleryContainer.style.display = "none";
});
gallerySelector.addEventListener("click", () => {
  console.log("switching to gallery tab");
  createSelector.classList.add("selector-deactivated");
  claimSelector.classList.add("selector-deactivated");
  gallerySelector.classList.remove("selector-deactivated");
  createContainer.style.display = "none";
  claimContainer.style.display = "none";
  galleryContainer.style.display = "block";
});

// on load
(function () {
  const secretKeyInput = document.getElementById("secretKeyInput") as HTMLInputElement;
  secretKeyInput.value = secretKey;
})();

// wallet & blockchain interaction
(async () => {
  const chainOptions = await getChainOptions();

  const controller = new WalletController({
    ...chainOptions,
  });

  connectExtensionButton.addEventListener("click", () => {
    controller.connect(ConnectType.CHROME_EXTENSION);
  });
  connectMobileButton.addEventListener("click", () => {
    controller.connect(ConnectType.WALLETCONNECT);
  });
  disconnectButton.addEventListener("click", () => {
    controller.disconnect();
  });

  controller.states().subscribe(async (states) => {
    // if wallet is NOT connected - hide status container, show connect container, disable submit
    if (states.status == WalletStatus.WALLET_NOT_CONNECTED) {
      console.log("wallet disconnected");
      walletStatusContainer.style.display = "none";
      walletConnectContainer.style.display = "inline-block";
      submitTxButton.classList.add("disabled");
    }
    // if wallet IS connected
    else if (states.status == WalletStatus.WALLET_CONNECTED) {
      console.log("wallet connected");
      const { chainID, lcd } = states.network;
      const wallet = states.wallets[0];

      // currently only columbus and bombay are supported
      if (chainID != "columbus-5" && chainID != "bombay-12") {
        alert(
          "ERROR: supported chain! use only `columbus-5` or `bombay-12`. you are using: " + chainID
        );
      }

      // show status container, hide connect container, enable submit
      walletStatusContainer.style.display = "inline-block";
      walletConnectContainer.style.display = "none";
      submitTxButton.classList.remove("disabled");

      // on desktop, show the full address
      // on mobile, show shorten address (only first & last 4 digits)
      walletAddressSpan.innerHTML =
        window.innerWidth > 650 ? wallet.terraAddress : shortenAddress(wallet.terraAddress);

      if (chainID === "columbus-5") {
        walletNetworkSpan.innerHTML = "Mainnet";
        walletNetworkSpan.classList.add("info-box-safe");
        walletNetworkSpan.classList.remove("info-box-danger");
      } else if (chainID === "bombay-12") {
        walletNetworkSpan.innerHTML = "Testnet";
        walletNetworkSpan.classList.remove("info-box-safe");
        walletNetworkSpan.classList.add("info-box-danger");
      }

      // query trophy info
      console.log("querying trophy info...");
      const terra = new LCDClient({
        chainID,
        URL: lcd,
      });
      const hub = chainID === "columbus-5" ? HUB_ADDRESS.mainnet : HUB_ADDRESS.testnet;
      const response: { metadata: Metadata } = await terra.wasm.contractQuery(hub, {
        trophy_info: {
          trophy_id: trophyId,
        },
      });
      console.log("done! response:", response);

      const { name, description, image } = response.metadata;
      trophyNameSpan.innerHTML = "🏆 " + (name ? name : "undefined") + " 🏆";
      trophyDescriptionSpan.innerHTML = description ? description : "undefined";
      trophyImage.src = ipfsToPinataGateway(image);

      // sign message
      // message content is simply user's address
      console.log("signing message...");
      const hash = Buffer.from(SHA256.hash(wallet.terraAddress).toString(), "hex");
      const privKey = base64ToBytes(secretKey);
      const { signature } = secp256k1.ecdsaSign(hash, privKey);
      console.log("done! signature:", bytesToBase64(signature));

      // submit tx
      submitTxButton.addEventListener("click", () => {
        const tx = {
          msgs: [
            new MsgExecuteContract(wallet.terraAddress, hub, {
              mint_by_signature: {
                trophy_id: trophyId,
                signature: bytesToBase64(signature),
              },
            }),
          ],
          feeDenoms: ["uusd"],
          gasPrices: "0.15uusd",
          gasAdjustment: 1.2,
        };
        console.log("sending tx:", tx);
        controller
          .post(tx)
          .then((result: TxResult) => {
            console.log("tx successful!");
            const { txhash } = result.result;
            const url = `https://finder.terra.money/${chainID}/tx/${txhash}`;
            const a = `<a rel="noopener noreferrer" target="_blank" href="${url}">${txhash}</a>`;
            txResult.innerHTML = `<span class="text-success">Success!</span><br>${a}`;
          })
          .catch((error: unknown) => {
            console.log("tx failed!", error);
            if (error instanceof UserDenied) {
              txResult.innerHTML = '<span class="text-danger">User denied!</span>';
            } else if (error instanceof CreateTxFailed) {
              txResult.innerHTML = '<span class="text-danger">Failed to create tx!</span>';
            } else if (error instanceof TxFailed) {
              txResult.innerHTML = '<span class="text-danger">Tx failed!</span>';
            } else if (error instanceof Timeout) {
              txResult.innerHTML = '<span class="text-danger">Timeout!</span>';
            } else if (error instanceof TxUnspecifiedError) {
              txResult.innerHTML = '<span class="text-danger">Unspecified error!</span>';
            } else {
              txResult.innerHTML = '<span class="text-danger">Unknown error!</span>';
            }
          });
      });
    }
  });
})();
