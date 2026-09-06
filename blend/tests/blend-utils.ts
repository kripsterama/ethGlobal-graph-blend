import { newMockEvent } from "matchstick-as"
import { ethereum, Address, BigInt, Bytes } from "@graphprotocol/graph-ts"
import {
  LoanOfferTaken,
  Repay,
  Refinance,
  Seize,
  StartAuction
} from "../generated/Blend/Blend"

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

export function createRefinanceEvent(
  lienId: BigInt,
  collection: Address,
  newLender: Address,
  newAmount: BigInt,
  newRate: BigInt,
  newAuctionDuration: BigInt
): Refinance {
  let refinanceEvent = changetype<Refinance>(newMockEvent())

  refinanceEvent.parameters = new Array()

  refinanceEvent.parameters.push(
    new ethereum.EventParam("lienId", ethereum.Value.fromUnsignedBigInt(lienId))
  )
  refinanceEvent.parameters.push(
    new ethereum.EventParam("collection", ethereum.Value.fromAddress(collection))
  )
  refinanceEvent.parameters.push(
    new ethereum.EventParam("newLender", ethereum.Value.fromAddress(newLender))
  )
  refinanceEvent.parameters.push(
    new ethereum.EventParam("newAmount", ethereum.Value.fromUnsignedBigInt(newAmount))
  )
  refinanceEvent.parameters.push(
    new ethereum.EventParam("newRate", ethereum.Value.fromUnsignedBigInt(newRate))
  )
  refinanceEvent.parameters.push(
    new ethereum.EventParam(
      "newAuctionDuration",
      ethereum.Value.fromUnsignedBigInt(newAuctionDuration)
    )
  )

  return refinanceEvent
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

export function createStartAuctionEvent(
  lienId: BigInt,
  collection: Address
): StartAuction {
  let startAuctionEvent = changetype<StartAuction>(newMockEvent())

  startAuctionEvent.parameters = new Array()

  startAuctionEvent.parameters.push(
    new ethereum.EventParam("lienId", ethereum.Value.fromUnsignedBigInt(lienId))
  )
  startAuctionEvent.parameters.push(
    new ethereum.EventParam("collection", ethereum.Value.fromAddress(collection))
  )

  return startAuctionEvent
}
