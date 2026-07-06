const dayjs = require("dayjs");
const Offer = require("../../models/Offer");

const listOffers = async () => {
  return Offer.find({}).sort({ createdAt: -1 }).lean();
};

const createOffer = async (payload) => {
  const offer = await Offer.create(payload);
  return offer.toObject();
};

const resolveApplicableOffer = async ({
  productId,
  optionId,
  promoCode,
  baseAmount,
  travelDate = null
}) => {
  const now = dayjs();
  const travel = travelDate ? dayjs(travelDate) : null;

  const query = {
    active: true,
    $or: [
      { startsAt: { $exists: false } },
      { startsAt: null },
      { startsAt: { $lte: now.toDate() } }
    ],
    $and: [
      {
        $or: [
          { endsAt: { $exists: false } },
          { endsAt: null },
          { endsAt: { $gte: now.toDate() } }
        ]
      }
    ]
  };

  if (promoCode) {
    query.code = promoCode.toUpperCase();
  } else {
    query.automaticCampaign = true;
  }

  const offers = await Offer.find(query).lean();

  const validTargetOffer = offers.find((offer) => {
    const productTargetOk = !offer.productIds?.length || offer.productIds.includes(productId);
    const optionTargetOk = !offer.optionIds?.length || offer.optionIds.includes(optionId);
    const travelDateOk = !travel || !offer.startsAt || travel.isAfter(dayjs(offer.startsAt).subtract(1, "day"));

    return productTargetOk && optionTargetOk && travelDateOk;
  });

  if (!validTargetOffer) {
    return {
      applied: false,
      discountAmount: 0,
      finalAmount: baseAmount,
      subsidyAmount: 0,
      offer: null
    };
  }

  const discountAmount =
    validTargetOffer.discountType === "percentage"
      ? (baseAmount * validTargetOffer.discountValue) / 100
      : validTargetOffer.discountValue;

  const safeDiscount = Math.max(0, Math.min(baseAmount, Number(discountAmount || 0)));

  return {
    applied: safeDiscount > 0,
    discountAmount: safeDiscount,
    finalAmount: Number((baseAmount - safeDiscount).toFixed(2)),
    subsidyAmount: safeDiscount,
    offer: {
      id: validTargetOffer._id,
      name: validTargetOffer.name,
      code: validTargetOffer.code,
      discountType: validTargetOffer.discountType,
      discountValue: validTargetOffer.discountValue,
      localSubsidyOnly: validTargetOffer.localSubsidyOnly
    }
  };
};

module.exports = {
  listOffers,
  createOffer,
  resolveApplicableOffer
};