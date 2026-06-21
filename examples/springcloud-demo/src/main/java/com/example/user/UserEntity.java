package com.example.user;

import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

@TableName("users")
public class UserEntity {
  @TableId private Long id; @TableField("name") private String name; @TableField("email") private String email;
  public UserEntity() {}
  public UserEntity(String name, String email) { this.name = name; this.email = email; }
}
