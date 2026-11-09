// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title BajarToken — fixed-supply ERC-20 launched from the creator's own wallet.
/// @notice No owner, no admin, no mint, no pause, no blacklist, no fees on transfer.
///         The whole supply is minted once to `recipient` in the constructor.
///         Holders can burn their own tokens (or an allowance), which lowers the supply.
contract BajarToken {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory name_, string memory symbol_, uint256 supply_, address recipient_) {
        require(recipient_ != address(0), "recipient");
        require(bytes(name_).length > 0 && bytes(name_).length <= 64, "name");
        require(bytes(symbol_).length > 0 && bytes(symbol_).length <= 16, "symbol");
        name = name_;
        symbol = symbol_;
        totalSupply = supply_;
        balanceOf[recipient_] = supply_;
        emit Transfer(address(0), recipient_, supply_);
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        _spendAllowance(from, value);
        _transfer(from, to, value);
        return true;
    }

    function burn(uint256 value) external {
        _burn(msg.sender, value);
    }

    function burnFrom(address from, uint256 value) external {
        _spendAllowance(from, value);
        _burn(from, value);
    }

    function _spendAllowance(address from, uint256 value) private {
        uint256 a = allowance[from][msg.sender];
        if (a != type(uint256).max) {
            require(a >= value, "allowance");
            unchecked { allowance[from][msg.sender] = a - value; }
        }
    }

    function _transfer(address from, address to, uint256 value) private {
        require(to != address(0), "to");
        uint256 b = balanceOf[from];
        require(b >= value, "balance");
        unchecked {
            balanceOf[from] = b - value;
            balanceOf[to] += value;
        }
        emit Transfer(from, to, value);
    }

    function _burn(address from, uint256 value) private {
        uint256 b = balanceOf[from];
        require(b >= value, "balance");
        unchecked {
            balanceOf[from] = b - value;
            totalSupply -= value;
        }
        emit Transfer(from, address(0), value);
    }
}
