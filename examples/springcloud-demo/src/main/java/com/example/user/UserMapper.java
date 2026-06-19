package com.example.user;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface UserMapper {

    String selectById(@Param("id") Long id);

    String selectAll();

    int insertUser(@Param("user") UserEntity user);

    int updateUser(@Param("user") UserEntity user);
}
