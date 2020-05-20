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

pragma solidity 0.5.2;

/**
 * EIP712 Ethereum typed structured data hashing and signing
 */
contract EIP712 {
    string internal constant DOMAIN_NAME = "Mai Protocol";

    /**
     * Hash of the EIP712 Domain Separator Schema
     *   0xb2178a58fb1eefb359ecfdd57bb19c0bdd0f4e6eed8547f46600e500ed111af3 ==
     *   keccak256(abi.encodePacked("EIP712Domain(string name)"))
     */
    bytes32 public constant EIP712_DOMAIN_TYPEHASH = 0xb2178a58fb1eefb359ecfdd57bb19c0bdd0f4e6eed8547f46600e500ed111af3;

    /**
     * Hash of the EIP712 Domain Separator
     *   0x4bf67a92331f9543ab43d10e3a08b582abd57f9f32f07724559d64f62b2df379 ==
     *   keccak256(abi.encodePacked(EIP712_DOMAIN_TYPEHASH, keccak256(bytes(DOMAIN_NAME))))
     */
    bytes32 public constant DOMAIN_SEPARATOR = 0x4bf67a92331f9543ab43d10e3a08b582abd57f9f32f07724559d64f62b2df379;

    /**
     * Calculates EIP712 encoding for a hash struct in this EIP712 Domain.
     *
     * @param eip712hash The EIP712 hash struct.
     * @return EIP712 hash applied to this EIP712 Domain.
     */
    function hashEIP712Message(bytes32 eip712hash) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, eip712hash));
    }
}
