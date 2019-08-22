pragma solidity ^0.4.24;

contract IMintable {

    function mint(address _to, uint _value) public;
    function burn(address _from, uint _value) public;

    event Mint(address indexed _to, uint _value);
    event Burn( address indexed _from, uint _value);
}