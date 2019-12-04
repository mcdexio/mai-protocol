/*
    Copyright 2019 mcdexio

    Copyright 2018 The Hydro Protocol Foundation

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

        http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.

*/

pragma solidity ^0.5.2;

contract LibExchangeErrors {
    string constant INVALID_TRADER = "INVALID_TRADER";
    string constant INVALID_SENDER = "INVALID_SENDER";
    // Taker order and maker order can't be matched
    string constant INVALID_MATCH = "INVALID_MATCH";
    string constant REDEEM_PRICE_NOT_MET = "REDEEM_PRICE_NOT_MET";
    string constant MINT_PRICE_NOT_MET = "MINT_PRICE_NOT_MET";
    string constant INVALID_SIDE = "INVALID_SIDE";
    // Signature validation failed
    string constant INVALID_ORDER_SIGNATURE = "INVALID_ORDER_SIGNATURE";
    // Taker order is not valid
    string constant ORDER_IS_NOT_FILLABLE = "ORDER_IS_NOT_FILLABLE";
    string constant MAKER_ORDER_CAN_NOT_BE_MARKET_ORDER = "MAKER_ORDER_CAN_NOT_BE_MARKET_ORDER";
    string constant TRANSFER_FROM_FAILED = "TRANSFER_FROM_FAILED";
    string constant MAKER_ORDER_OVER_MATCH = "MAKER_ORDER_OVER_MATCH";
    string constant TAKER_ORDER_OVER_MATCH = "TAKER_ORDER_OVER_MATCH";
    string constant ORDER_VERSION_NOT_SUPPORTED = "ORDER_VERSION_NOT_SUPPORTED";
    string constant MAKER_ONLY_ORDER_CANNOT_BE_TAKER = "MAKER_ONLY_ORDER_CANNOT_BE_TAKER";
    string constant TRANSFER_FAILED = "TRANSFER_FAILED";
    string constant MINT_POSITION_TOKENS_FAILED = "MINT_FAILED";
    string constant REDEEM_POSITION_TOKENS_FAILED = "REDEEM_FAILED";
    string constant UNEXPECTED_MATCH = "UNEXPECTED_MATCH";
    string constant INSUFFICIENT_FEE = "INSUFFICIENT_FEE";
    string constant INVALID_MARKET_CONTRACT = "INVALID_MARKET_CONTRACT";
    string constant UNMATCHED_FILL = "UNMATCHED_FILL";
    string constant LOW_MARGIN = "LOW_MARGIN";
    string constant INVALID_AMOUNT = "LOW_MARGIN";
    string constant MAKER_CAN_NOT_BE_SAME_WITH_TAKER = "MAKER_CANNOT_BE_TAKER";
}
