/*

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
 * @title LibRelayer provides two distinct features for relayers.
 *
 * First, Relayers can opt into or out of the Mai liquidity incentive system.
 *
 * Second, a relayer can register a delegate address.
 * Delegates can send matching requests on behalf of relayers.
 * The delegate scheme allows additional possibilities for smart contract interaction.
 * on behalf of the relayer.
 */
contract LibRelayer {

    /**
     * Mapping of relayerAddress => delegateAddress
     */
    mapping (address => mapping (address => bool)) public relayerDelegates;

    event RelayerApproveDelegate(address indexed relayer, address indexed delegate);
    event RelayerRevokeDelegate(address indexed relayer, address indexed delegate);

    /**
     * Approve an address to match orders on behalf of msg.sender
     */
    function approveDelegate(address delegate) external {
        relayerDelegates[msg.sender][delegate] = true;
        emit RelayerApproveDelegate(msg.sender, delegate);
    }

    /**
     * Revoke an existing delegate
     */
    function revokeDelegate(address delegate) external {
        relayerDelegates[msg.sender][delegate] = false;
        emit RelayerRevokeDelegate(msg.sender, delegate);
    }

    /**
     * @return true if msg.sender is allowed to match orders which belong to relayer
     */
    function canMatchMarketContractOrdersFrom(address relayer) public view returns(bool) {
        return msg.sender == relayer || relayerDelegates[relayer][msg.sender] == true;
    }
}