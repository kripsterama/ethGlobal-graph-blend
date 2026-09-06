import {
  assert,
  describe,
  test,
  clearStore,
  beforeAll,
  afterAll
} from "matchstick-as/assembly/index"
import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts"
import {
  handleLoanOfferTaken,
  handleRepay,
  handleSeize,
  handleStartAuction
} from "../src/blend"
import {
  createLoanOfferTakenEvent,
  createRepayEvent,
  createSeizeEvent,
  createStartAuctionEvent
} from "./blend-utils"

const LIEN_ID = "1"
const BORROWER = "0x00000000000000000000000000000000000000b0"
const LENDER = "0x00000000000000000000000000000000000000e1"
const COLLECTION = "0x000000000000000000000000000000000000c001"

describe("handleLoanOfferTaken", () => {
  beforeAll(() => {
    let offerHash = Bytes.fromI32(1234567890)
    let lienId = BigInt.fromString(LIEN_ID)
    let collection = Address.fromString(COLLECTION)
    let lender = Address.fromString(LENDER)
    let borrower = Address.fromString(BORROWER)
    let loanAmount = BigInt.fromString("1000000000000000000")
    let rate = BigInt.fromI32(500)
    let tokenId = BigInt.fromI32(42)
    let auctionDuration = BigInt.fromI32(86400)

    let event = createLoanOfferTakenEvent(
      offerHash,
      lienId,
      collection,
      lender,
      borrower,
      loanAmount,
      rate,
      tokenId,
      auctionDuration
    )
    handleLoanOfferTaken(event)
  })

  afterAll(() => {
    clearStore()
  })

  test("creates a Lien with fields from the event", () => {
    assert.entityCount("Lien", 1)
    assert.fieldEquals("Lien", LIEN_ID, "borrower", BORROWER)
    assert.fieldEquals("Lien", LIEN_ID, "lender", LENDER)
    assert.fieldEquals("Lien", LIEN_ID, "collection", COLLECTION)
    assert.fieldEquals("Lien", LIEN_ID, "tokenId", "42")
    assert.fieldEquals("Lien", LIEN_ID, "loanAmount", "1000000000000000000")
    assert.fieldEquals("Lien", LIEN_ID, "rate", "500")
    assert.fieldEquals("Lien", LIEN_ID, "auctionDuration", "86400")
    assert.fieldEquals("Lien", LIEN_ID, "status", "ACTIVE")
    assert.fieldEquals("Lien", LIEN_ID, "auctionStartBlock", "null")
  })

  test("creates borrower and lender Accounts", () => {
    assert.entityCount("Account", 2)
  })

  test("logs a LienEvent for the loan origination", () => {
    assert.entityCount("LienEvent", 1)
  })
})

describe("handleRepay", () => {
  beforeAll(() => {
    let event = createLoanOfferTakenEvent(
      Bytes.fromI32(1234567890),
      BigInt.fromString(LIEN_ID),
      Address.fromString(COLLECTION),
      Address.fromString(LENDER),
      Address.fromString(BORROWER),
      BigInt.fromString("1000000000000000000"),
      BigInt.fromI32(500),
      BigInt.fromI32(42),
      BigInt.fromI32(86400)
    )
    handleLoanOfferTaken(event)
  })

  afterAll(() => {
    clearStore()
  })

  test("marks the lien REPAID and logs a LienEvent", () => {
    let repayEvent = createRepayEvent(
      BigInt.fromString(LIEN_ID),
      Address.fromString(COLLECTION)
    )
    // newMockEvent() defaults to the same tx hash/logIndex as the seed
    // LoanOfferTaken event; bump logIndex so the LienEvent ids don't collide.
    repayEvent.logIndex = BigInt.fromI32(2)
    handleRepay(repayEvent)

    assert.fieldEquals("Lien", LIEN_ID, "status", "REPAID")
    assert.entityCount("LienEvent", 2)
  })

  test("is a no-op when the lien is unknown", () => {
    let unknownLienId = "999"
    let repayEvent = createRepayEvent(
      BigInt.fromString(unknownLienId),
      Address.fromString(COLLECTION)
    )
    handleRepay(repayEvent)

    assert.notInStore("Lien", unknownLienId)
    assert.entityCount("Lien", 1)
  })
})

describe("handleSeize", () => {
  beforeAll(() => {
    let event = createLoanOfferTakenEvent(
      Bytes.fromI32(1234567890),
      BigInt.fromString(LIEN_ID),
      Address.fromString(COLLECTION),
      Address.fromString(LENDER),
      Address.fromString(BORROWER),
      BigInt.fromString("1000000000000000000"),
      BigInt.fromI32(500),
      BigInt.fromI32(42),
      BigInt.fromI32(86400)
    )
    handleLoanOfferTaken(event)
  })

  afterAll(() => {
    clearStore()
  })

  test("marks the lien SEIZED and logs a LienEvent", () => {
    let seizeEvent = createSeizeEvent(
      BigInt.fromString(LIEN_ID),
      Address.fromString(COLLECTION)
    )
    // newMockEvent() defaults to the same tx hash/logIndex as the seed
    // LoanOfferTaken event; bump logIndex so the LienEvent ids don't collide.
    seizeEvent.logIndex = BigInt.fromI32(2)
    handleSeize(seizeEvent)

    assert.fieldEquals("Lien", LIEN_ID, "status", "SEIZED")
    assert.entityCount("LienEvent", 2)
  })

  test("is a no-op when the lien is unknown", () => {
    let unknownLienId = "999"
    let seizeEvent = createSeizeEvent(
      BigInt.fromString(unknownLienId),
      Address.fromString(COLLECTION)
    )
    handleSeize(seizeEvent)

    assert.notInStore("Lien", unknownLienId)
    assert.entityCount("Lien", 1)
  })
})

describe("handleStartAuction", () => {
  beforeAll(() => {
    let event = createLoanOfferTakenEvent(
      Bytes.fromI32(1234567890),
      BigInt.fromString(LIEN_ID),
      Address.fromString(COLLECTION),
      Address.fromString(LENDER),
      Address.fromString(BORROWER),
      BigInt.fromString("1000000000000000000"),
      BigInt.fromI32(500),
      BigInt.fromI32(42),
      BigInt.fromI32(86400)
    )
    handleLoanOfferTaken(event)
  })

  afterAll(() => {
    clearStore()
  })

  test("marks the lien IN_AUCTION, sets auctionStartBlock, and logs a LienEvent", () => {
    let startAuctionEvent = createStartAuctionEvent(
      BigInt.fromString(LIEN_ID),
      Address.fromString(COLLECTION)
    )
    // newMockEvent() defaults to the same tx hash/logIndex as the seed
    // LoanOfferTaken event; bump logIndex so the LienEvent ids don't collide.
    startAuctionEvent.logIndex = BigInt.fromI32(2)
    handleStartAuction(startAuctionEvent)

    assert.fieldEquals("Lien", LIEN_ID, "status", "IN_AUCTION")
    assert.fieldEquals(
      "Lien",
      LIEN_ID,
      "auctionStartBlock",
      startAuctionEvent.block.number.toString()
    )
    assert.entityCount("LienEvent", 2)
  })

  test("is a no-op when the lien is unknown", () => {
    let unknownLienId = "999"
    let startAuctionEvent = createStartAuctionEvent(
      BigInt.fromString(unknownLienId),
      Address.fromString(COLLECTION)
    )
    handleStartAuction(startAuctionEvent)

    assert.notInStore("Lien", unknownLienId)
    assert.entityCount("Lien", 1)
  })
})
