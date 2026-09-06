import { newMockEvent } from "matchstick-as"
import { ethereum, Address, BigInt, Bytes } from "@graphprotocol/graph-ts"
import { LoanOfferTaken, Repay, Seize } from "../generated/Blend/Blend"

export function createLoanOfferTakenEvent(
  offerHash: Bytes,
  lienId: BigInt,
  collection: Address,
  lender: Address,
  borrower: Address,
  loanAmount: BigInt,
  rate: BigInt,
  tokenId: BigInt,
  auctionDuration: BigInt
): LoanOfferTaken {
  let loanOfferTakenEvent = changetype<LoanOfferTaken>(newMockEvent())

  loanOfferTakenEvent.parameters = new Array()

  loanOfferTakenEvent.parameters.push(
    new ethereum.EventParam("offerHash", ethereum.Value.fromFixedBytes(offerHash))
  )
  loanOfferTakenEvent.parameters.push(
    new ethereum.EventParam("lienId", ethereum.Value.fromUnsignedBigInt(lienId))
  )
  loanOfferTakenEvent.parameters.push(
    new ethereum.EventParam("collection", ethereum.Value.fromAddress(collection))
  )
  loanOfferTakenEvent.parameters.push(
    new ethereum.EventParam("lender", ethereum.Value.fromAddress(lender))
  )
  loanOfferTakenEvent.parameters.push(
    new ethereum.EventParam("borrower", ethereum.Value.fromAddress(borrower))
  )
  loanOfferTakenEvent.parameters.push(
    new ethereum.EventParam("loanAmount", ethereum.Value.fromUnsignedBigInt(loanAmount))
  )
  loanOfferTakenEvent.parameters.push(
    new ethereum.EventParam("rate", ethereum.Value.fromUnsignedBigInt(rate))
  )
  loanOfferTakenEvent.parameters.push(
    new ethereum.EventParam("tokenId", ethereum.Value.fromUnsignedBigInt(tokenId))
  )
  loanOfferTakenEvent.parameters.push(
    new ethereum.EventParam(
      "auctionDuration",
      ethereum.Value.fromUnsignedBigInt(auctionDuration)
    )
  )

  return loanOfferTakenEvent
}

export function createRepayEvent(lienId: BigInt, collection: Address): Repay {
  let repayEvent = changetype<Repay>(newMockEvent())

  repayEvent.parameters = new Array()

  repayEvent.parameters.push(
    new ethereum.EventParam("lienId", ethereum.Value.fromUnsignedBigInt(lienId))
  )
  repayEvent.parameters.push(
    new ethereum.EventParam("collection", ethereum.Value.fromAddress(collection))
  )

  return repayEvent
}

export function createSeizeEvent(lienId: BigInt, collection: Address): Seize {
  let seizeEvent = changetype<Seize>(newMockEvent())

  seizeEvent.parameters = new Array()

  seizeEvent.parameters.push(
    new ethereum.EventParam("lienId", ethereum.Value.fromUnsignedBigInt(lienId))
  )
  seizeEvent.parameters.push(
    new ethereum.EventParam("collection", ethereum.Value.fromAddress(collection))
  )

  return seizeEvent
}
