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
  handleBuyLocked,
  handleLoanOfferTaken,
  handleRefinance,
  handleRepay,
  handleSeize,
  handleStartAuction
} from "../src/blend"
import {
  createBuyLockedEvent,
  createLoanOfferTakenEvent,
  createRefinanceEvent,
  createRepayEvent,
  createSeizeEvent,
  createStartAuctionEvent
} from "./blend-utils"

const LIEN_ID = "1"
const BORROWER = "0x00000000000000000000000000000000000000b0"
const LENDER = "0x00000000000000000000000000000000000000e1"
const COLLECTION = "0x000000000000000000000000000000000000c001"
const NEW_LENDER = "0x000000000000000000000000000000000000e2e2"

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
    assert.fieldEquals("Lien", LIEN_ID, "interestStartTimestamp", "1")
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
    // newMockEvent() defaults to the same tx hash/logIndex/timestamp as the
    // seed LoanOfferTaken event; bump logIndex so the LienEvent ids don't
    // collide, and bump timestamp to distinguish updatedAtTimestamp from
    // interestStartTimestamp below.
    startAuctionEvent.logIndex = BigInt.fromI32(2)
    startAuctionEvent.block.timestamp = BigInt.fromI32(200)
    handleStartAuction(startAuctionEvent)

    assert.fieldEquals("Lien", LIEN_ID, "status", "IN_AUCTION")
    assert.fieldEquals(
      "Lien",
      LIEN_ID,
      "auctionStartBlock",
      startAuctionEvent.block.number.toString()
    )
    assert.fieldEquals("Lien", LIEN_ID, "updatedAtTimestamp", "200")
    // The contract leaves lien.startTime untouched when an auction starts
    // (interest keeps accruing against the original terms) — this must
    // still read the LoanOfferTaken timestamp, not the StartAuction one.
    assert.fieldEquals("Lien", LIEN_ID, "interestStartTimestamp", "1")
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

describe("handleRefinance", () => {
  beforeAll(() => {
    let loanOfferTakenEvent = createLoanOfferTakenEvent(
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
    handleLoanOfferTaken(loanOfferTakenEvent)

    // put the lien into an active auction so refinance's job of clearing
    // that state is actually exercised.
    let startAuctionEvent = createStartAuctionEvent(
      BigInt.fromString(LIEN_ID),
      Address.fromString(COLLECTION)
    )
    startAuctionEvent.logIndex = BigInt.fromI32(2)
    handleStartAuction(startAuctionEvent)
  })

  afterAll(() => {
    clearStore()
  })

  test("switches lender, updates loan terms, and clears auction state", () => {
    let refinanceEvent = createRefinanceEvent(
      BigInt.fromString(LIEN_ID),
      Address.fromString(COLLECTION),
      Address.fromString(NEW_LENDER),
      BigInt.fromString("2000000000000000000"),
      BigInt.fromI32(750),
      BigInt.fromI32(172800)
    )
    // newMockEvent() defaults to the same tx hash/logIndex/timestamp as the
    // seed events; bump logIndex so the LienEvent ids don't collide, and
    // bump timestamp to prove interestStartTimestamp actually resets.
    refinanceEvent.logIndex = BigInt.fromI32(3)
    refinanceEvent.block.timestamp = BigInt.fromI32(500)
    handleRefinance(refinanceEvent)

    assert.fieldEquals("Lien", LIEN_ID, "lender", NEW_LENDER)
    assert.fieldEquals("Lien", LIEN_ID, "loanAmount", "2000000000000000000")
    assert.fieldEquals("Lien", LIEN_ID, "rate", "750")
    assert.fieldEquals("Lien", LIEN_ID, "auctionDuration", "172800")
    assert.fieldEquals("Lien", LIEN_ID, "status", "ACTIVE")
    assert.fieldEquals("Lien", LIEN_ID, "auctionStartBlock", "null")
    // Refinance pays off the old loan and starts a fresh one — the interest
    // clock must reset to this event's timestamp, not stay at origination.
    assert.fieldEquals("Lien", LIEN_ID, "interestStartTimestamp", "500")
    assert.entityCount("Account", 3)
    assert.entityCount("LienEvent", 3)
  })

  test("is a no-op when the lien is unknown", () => {
    let unknownLienId = "999"
    let refinanceEvent = createRefinanceEvent(
      BigInt.fromString(unknownLienId),
      Address.fromString(COLLECTION),
      Address.fromString(NEW_LENDER),
      BigInt.fromString("2000000000000000000"),
      BigInt.fromI32(750),
      BigInt.fromI32(172800)
    )
    handleRefinance(refinanceEvent)

    assert.notInStore("Lien", unknownLienId)
    assert.entityCount("Lien", 1)
  })
})

describe("handleBuyLocked", () => {
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

  test("marks the lien SOLD_LOCKED and logs a LienEvent", () => {
    let buyLockedEvent = createBuyLockedEvent(
      BigInt.fromString(LIEN_ID),
      Address.fromString(COLLECTION),
      Address.fromString(NEW_LENDER),
      Address.fromString(BORROWER),
      BigInt.fromI32(42)
    )
    // newMockEvent() defaults to the same tx hash/logIndex as the seed
    // LoanOfferTaken event; bump logIndex so the LienEvent ids don't collide.
    buyLockedEvent.logIndex = BigInt.fromI32(2)
    handleBuyLocked(buyLockedEvent)

    assert.fieldEquals("Lien", LIEN_ID, "status", "SOLD_LOCKED")
    assert.entityCount("LienEvent", 2)
  })

  test("is a no-op when the lien is unknown", () => {
    let unknownLienId = "999"
    let buyLockedEvent = createBuyLockedEvent(
      BigInt.fromString(unknownLienId),
      Address.fromString(COLLECTION),
      Address.fromString(NEW_LENDER),
      Address.fromString(BORROWER),
      BigInt.fromI32(42)
    )
    handleBuyLocked(buyLockedEvent)

    assert.notInStore("Lien", unknownLienId)
    assert.entityCount("Lien", 1)
  })
})
