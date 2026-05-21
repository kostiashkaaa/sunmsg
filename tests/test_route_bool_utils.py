from app.routes.bool_utils import coerce_bool_flag


def test_coerce_bool_flag_handles_db_and_string_values():
    assert coerce_bool_flag(True) is True
    assert coerce_bool_flag(False) is False
    assert coerce_bool_flag(1) is True
    assert coerce_bool_flag(0) is False
    assert coerce_bool_flag('yes') is True
    assert coerce_bool_flag('OFF') is False
    assert coerce_bool_flag(None, default=True) is True
    assert coerce_bool_flag(None, default=False) is False
