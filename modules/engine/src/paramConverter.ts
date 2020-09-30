import { WithdrawCommitment } from "@connext/vector-contracts";
import { getRandomBytes32, getSignerAddressFromPublicIdentifier } from "@connext/vector-utils";
import {
  CreateTransferParams,
  ConditionalTransferType,
  ResolveTransferParams,
  FullChannelState,
  LinkedTransferStateEncoding,
  LinkedTransferResolverEncoding,
  LinkedTransferState,
  Result,
  DEFAULT_TRANSFER_TIMEOUT,
  FullTransferState,
  LinkedTransferResolver,
  WithdrawState,
  WithdrawStateEncoding,
  WithdrawResolverEncoding,
  EngineParams,
  IChannelSigner,
  ChainAddresses,
  RouterSchemas,
} from "@connext/vector-types";
import { BigNumber } from "ethers";

import { InvalidTransferType } from "./errors";

export function convertConditionalTransferParams(
  params: EngineParams.ConditionalTransfer,
  signer: IChannelSigner,
  channel: FullChannelState,
  chainAddresses: ChainAddresses,
): Result<CreateTransferParams, InvalidTransferType> {
  const { channelAddress, amount, assetId, recipient, details, timeout, meta: providedMeta } = params;

  const recipientChainId = params.recipientChainId ?? channel.networkContext.chainId;
  const recipientAssetId = params.recipientAssetId ?? params.assetId;
  const channelCounterparty = signer.address === channel.alice ? channel.bob : channel.alice;

  // If the recipient is the channel counterparty, no default routing
  // meta needs to be created, otherwise create the default routing meta.
  // NOTE: While the engine and protocol do not care about the structure
  // of the meta, this is where several relevant default values are
  // set for the higher level modules to parse
  let baseRoutingMeta: RouterSchemas.RouterMeta | undefined = undefined;
  if (recipient && getSignerAddressFromPublicIdentifier(recipient) !== channelCounterparty) {
    baseRoutingMeta = {
      requireOnline: false, // TODO: change with more transfer types?
      routingId: providedMeta.routingId ?? getRandomBytes32(),
      path: [{ recipient, recipientChainId, recipientAssetId }],
    };
  }

  // TODO: transfers should be allowed to go to participants outside of the
  // channel (i.e. some dispute recovery address). This should be passed in
  // via the transfer params as a `recoveryAddress` variable
  // const transferStateRecipient = recipient ? getSignerAddressFromPublicIdentifier(recipient) : channelCounterparty;

  let transferDefinition: string | undefined;
  let transferInitialState: LinkedTransferState;
  let encodings: string[];

  if (params.conditionType === ConditionalTransferType.LinkedTransfer) {
    transferDefinition = chainAddresses[channel.networkContext.chainId].linkedTransferDefinition;
    transferInitialState = {
      balance: {
        amount: [amount, "0"],
        to: [signer.address, channelCounterparty],
      },
      linkedHash: details.linkedHash,
    };
    encodings = [LinkedTransferStateEncoding, LinkedTransferResolverEncoding];
  } else {
    return Result.fail(new InvalidTransferType(params.conditionType));
  }

  return Result.ok({
    channelAddress,
    amount,
    assetId,
    transferDefinition: transferDefinition!,
    transferInitialState,
    timeout: timeout || DEFAULT_TRANSFER_TIMEOUT.toString(),
    encodings,
    meta: {
      ...(baseRoutingMeta ?? {}),
      ...(providedMeta ?? {}),
    },
  });
}

export function convertResolveConditionParams(
  params: EngineParams.ResolveTransfer,
  transfer: FullTransferState,
): Result<ResolveTransferParams, InvalidTransferType> {
  const { channelAddress, details, meta } = params;
  let transferResolver: LinkedTransferResolver;

  if (params.conditionType == ConditionalTransferType.LinkedTransfer) {
    transferResolver = {
      preImage: details.preImage,
    };
  } else {
    return Result.fail(new InvalidTransferType(params.conditionType));
  }

  return Result.ok({
    channelAddress,
    transferId: transfer.transferId,
    transferResolver,
    meta: { details: meta ?? {} },
  });
}

export async function convertWithdrawParams(
  params: EngineParams.Withdraw,
  signer: IChannelSigner,
  channel: FullChannelState,
  chainAddresses: ChainAddresses,
): Promise<Result<CreateTransferParams, InvalidTransferType>> {
  const { channelAddress, assetId, recipient, fee } = params;

  // If there is a fee being charged, add the fee to the amount.
  const amount = fee
    ? BigNumber.from(params.amount)
        .add(fee)
        .toString()
    : params.amount;

  const commitment = new WithdrawCommitment(
    channel.channelAddress,
    signer.address,
    signer.address === channel.alice ? channel.bob : channel.alice,
    params.recipient,
    assetId,
    // Important: Use params.amount here which doesn't include fee!!
    params.amount,
    // Use channel nonce as a way to keep withdraw hashes unique
    channel.nonce.toString(),
  );

  const initiatorSignature = await signer.signMessage(commitment.hashToSign());

  const channelCounterparty = channel.alice == signer.address ? channel.bob : channel.alice;

  const transferInitialState: WithdrawState = {
    balance: {
      amount: [amount, "0"],
      to: [recipient, channelCounterparty],
    },
    initiatorSignature,
    initiator: signer.address,
    responder: channelCounterparty,
    data: commitment.hashToSign(),
    nonce: channel.nonce.toString(),
    fee: fee ? fee : "0",
  };

  return Result.ok({
    channelAddress,
    amount,
    assetId,
    transferDefinition: chainAddresses[channel.networkContext.chainId].withdrawDefinition!,
    transferInitialState,
    timeout: DEFAULT_TRANSFER_TIMEOUT.toString(),
    encodings: [WithdrawStateEncoding, WithdrawResolverEncoding],
    // Note: we MUST include withdrawNonce in meta. The counterparty will NOT have the same nonce on their end otherwise.
    meta: {
      withdrawNonce: channel.nonce.toString(),
    },
  });
}
